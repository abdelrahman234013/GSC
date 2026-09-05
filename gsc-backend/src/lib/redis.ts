import Redis from "ioredis";

// The Redis connection, shared by the cache and the rate limiter.
//
// THE GOVERNING RULE: Redis is optional. Postgres is the source of truth; Redis
// only holds copies and counters. If it is down, unreachable, or not configured
// at all, the app must keep serving requests — just without the speedup. Every
// call site treats a Redis failure as a cache miss, never as an error.
//
// That rule is why this module never throws on connection problems and why
// getRedis() can legitimately return null. Losing a cache entry is free; it can
// always be recomputed from the database. Taking the site down because a cache
// is unavailable would be a self-inflicted outage.
//
// Not configured (REDIS_URL unset) is a supported state: local development, CI,
// and the automated tests all run without Redis.

let client: Redis | null = null;
let initialised = false;
let healthy = false;

export function getRedis(): Redis | null {
  if (initialised) return healthy ? client : null;
  initialised = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("REDIS_URL not set — running without cache (this is supported).");
    return null;
  }

  const connection = new Redis(url, {
    // Fail fast rather than queueing commands forever when Redis is down. A
    // request should fall through to Postgres in milliseconds, not hang.
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    // Without this, ioredis buffers commands while disconnected and they all
    // resolve late (or never) — turning a cache outage into stalled requests.
    enableOfflineQueue: false,
    // Back off on reconnect attempts instead of hammering a dead server.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  client = connection;

  // Every handler checks it is still the CURRENT client before touching shared
  // state. A closed connection keeps emitting for a while, and a late 'error'
  // from a discarded client would otherwise mark a healthy new connection as
  // dead — a bug that only appears after a reconnect, which is the worst time.
  connection.on("ready", () => {
    if (client !== connection) return;
    healthy = true;
    console.log("Redis connected — cache active.");
  });

  // MUST be handled. An unhandled 'error' event on an ioredis client is an
  // unhandled exception, which would crash the process — the exact opposite of
  // "a cache outage must not take down the app".
  connection.on("error", (err) => {
    if (client !== connection) return;
    if (healthy) console.error("Redis error — falling back to database:", err.message);
    healthy = false;
  });

  connection.on("end", () => {
    if (client !== connection) return;
    healthy = false;
  });

  return connection;
}

/** True when Redis is connected and usable right now. */
export function isRedisHealthy(): boolean {
  return healthy;
}

/**
 * Closes the connection during graceful shutdown. Never throws.
 *
 * Also resets the module back to its uninitialised state, so the next
 * getRedis() re-reads REDIS_URL and reconnects rather than handing out a dead
 * client. Without that reset this module would be a one-shot: once closed, the
 * memoised `initialised` flag would make every later call return null forever.
 */
export async function closeRedis(): Promise<void> {
  const connection = client;
  client = null;
  initialised = false;
  healthy = false;
  if (!connection) return;
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
}
