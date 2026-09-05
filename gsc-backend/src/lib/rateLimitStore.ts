import { MemoryStore } from "express-rate-limit";
import type {
  ClientRateLimitInfo,
  IncrementResponse,
  Options,
  Store,
} from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedis, isRedisHealthy } from "./redis";

// Where rate-limit counters live.
//
// WHY NOT JUST express-rate-limit's DEFAULT MEMORY STORE: counters kept in the
// process have two holes. They reset on every deploy or restart, so an attacker
// mid-way through guessing a password gets a clean slate every time we ship. And
// if the app ever runs as more than one instance, each keeps its own counts, so
// the real allowance is (limit x instances) — a limit of 5 becomes 20 behind
// four workers.
//
// WHY NOT JUST RedisStore: it would make the limiter a hard dependency on Redis.
// A Redis outage would then turn every rate-limited route — sign-in, checkout,
// the contact form — into a 500, because express-rate-limit passes a store
// rejection to next(err). That trades a cache outage for a site outage, which is
// exactly the trade src/lib/redis.ts exists to refuse.
//
// So: Redis when it is there, memory when it isn't, switching between them at
// runtime without dropping requests.
//
// THE TRADE-OFF, stated honestly: during a Redis outage, counters restart from
// zero in memory and are no longer shared between instances. An attacker who
// happens to be mid-attack at that moment gets a fresh budget. That is strictly
// better than the alternative on offer — no limiting at all, because the whole
// endpoint is returning 500.

/**
 * How long to wait before retrying Redis after a failure.
 *
 * Without this, every single request during an outage would attempt a fresh
 * connection and script load, adding latency to requests that are already going
 * to fall back to memory anyway.
 */
const RETRY_COOLDOWN_MS = 5_000;

export class ResilientRateLimitStore implements Store {
  /**
   * False tells express-rate-limit's double-count validator that keys may be
   * shared across instances, which is true whenever Redis is up.
   */
  localKeys = false;

  /** Keeps each limiter's counters separate inside one shared Redis. */
  readonly prefix: string;

  private readonly memory = new MemoryStore();
  private options?: Options;
  private redis: RedisStore | null = null;
  /** The in-flight connection attempt, shared by every concurrent caller. */
  private pending: Promise<RedisStore | null> | null = null;
  private retryAfter = 0;
  private warned = false;

  constructor(name: string) {
    this.prefix = `gsc:rl:${name}:`;
  }

  init(options: Options) {
    this.options = options;
    this.memory.init(options);
    // Not awaited: init() runs at import time, when the Redis connection is
    // still being established. Attaching lazily on first use is what lets the
    // app boot before Redis does.
    void this.connect();
  }

  /**
   * Returns a ready RedisStore, or null if Redis isn't usable right now.
   *
   * Concurrent callers SHARE one in-flight attempt. Without that, the cooldown
   * set at the start of an attempt would immediately turn away every request
   * that arrives while the first one is still connecting — so the busiest
   * moment (just after a deploy, when init() has fired but not finished) would
   * be the one moment the limiter quietly ran on per-process counters.
   */
  private connect(): Promise<RedisStore | null> {
    if (this.redis && isRedisHealthy()) return Promise.resolve(this.redis);

    this.redis = null;
    if (this.pending) return this.pending;
    if (Date.now() < this.retryAfter) return Promise.resolve(null);

    const client = getRedis();
    if (!client || !isRedisHealthy()) return Promise.resolve(null);

    this.pending = this.attach(client).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Builds a fresh RedisStore and loads its script.
   *
   * Rebuilding rather than reusing the old store matters: RedisStore caches the
   * SHA of a Lua script it loaded into the server. A Redis that restarted has an
   * empty script cache, and a store still holding a rejected script promise from
   * a failed init never recovers on its own.
   */
  private async attach(client: NonNullable<ReturnType<typeof getRedis>>) {
    this.retryAfter = Date.now() + RETRY_COOLDOWN_MS;
    try {
      const store = new RedisStore({
        prefix: this.prefix,
        // rate-limit-redis talks to Redis through this one generic function,
        // which is how it stays independent of any particular client library.
        sendCommand: (...args: string[]) =>
          client.call(...(args as [string, ...string[]])) as any,
      });
      // Loads the atomic increment script. INCR and EXPIRE as two round trips
      // would race: two requests can both see a fresh key and both set a new
      // expiry, extending the window indefinitely.
      await store.init(this.options as any);
      this.redis = store;
      this.retryAfter = 0;
      this.warned = false;
      return store;
    } catch (err) {
      this.demote(err);
      return null;
    }
  }

  /** Drops back to memory and holds off on Redis for a cooldown. */
  private demote(err: unknown) {
    this.redis = null;
    this.retryAfter = Date.now() + RETRY_COOLDOWN_MS;
    if (!this.warned) {
      this.warned = true;
      console.error(
        `Rate limiter ${this.prefix} falling back to in-memory counters:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    const store = await this.connect();
    if (store) {
      try {
        return await store.increment(key);
      } catch (err) {
        this.demote(err);
      }
    }
    return this.memory.increment(key);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const store = await this.connect();
    if (store) {
      try {
        return await store.get(key);
      } catch (err) {
        this.demote(err);
      }
    }
    return this.memory.get(key);
  }

  /**
   * Both stores, deliberately. decrement() is what powers
   * skipSuccessfulRequests — a successful sign-in must give the attempt back.
   * Since a request may have been counted in either store, refunding only one
   * would let successful logins slowly accumulate against the user.
   */
  async decrement(key: string): Promise<void> {
    const store = await this.connect();
    if (store) {
      try {
        await store.decrement(key);
      } catch (err) {
        this.demote(err);
      }
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    const store = await this.connect();
    if (store) {
      try {
        await store.resetKey(key);
      } catch (err) {
        this.demote(err);
      }
    }
    await this.memory.resetKey(key);
  }

  /**
   * Clears the local counters only. The shared Redis counters are left alone on
   * purpose: this runs per-process, and wiping everyone's limits because one
   * instance shut down would hand an attacker a reset button.
   */
  shutdown() {
    this.memory.shutdown();
  }
}

/** One store per limiter — sharing one would merge unrelated counters. */
export function rateLimitStore(name: string): Store {
  return new ResilientRateLimitStore(name);
}
