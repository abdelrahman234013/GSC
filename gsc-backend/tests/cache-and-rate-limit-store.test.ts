// Proves the Redis layer does what it claims — and, more importantly, that it
// degrades correctly when Redis is not there.
//
// A cache is easy to test when everything works. The parts that actually matter
// in production are the ones that only show up under failure:
//
//   - Redis absent entirely (local dev, CI): must behave as if there were no
//     cache at all, not throw.
//   - Redis dies mid-request: must fall through to Postgres, not 500.
//   - Rate limiting must keep limiting through all of the above. A limiter that
//     stops limiting during a Redis outage is worse than no limiter, because
//     nobody notices.
//
// It also enforces the rule that keeps caching from becoming a data breach:
// nothing user-scoped may ever be cached. See the comment at the top of
// src/lib/cache.ts.
//
// Requires a local Redis (docker compose up -d redis).
// Run with:  npm run test:cache

import "dotenv/config";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import Redis from "ioredis";

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${label}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`);
  }
}

/**
 * Points the (single, shared) module graph at a given REDIS_URL.
 *
 * redis.ts reads REDIS_URL once and memoises the connection, so switching
 * scenarios means resetting it. closeRedis() is what does that — and it has to
 * be the mechanism rather than re-importing with a cache-busting query string,
 * because a busted import only creates a fresh copy of the module you NAME.
 * cache.ts and rateLimitStore.ts import "./redis" with no query, so they would
 * keep binding to the ORIGINAL redis module and every scenario after the first
 * would silently test nothing while still reporting PASS.
 */
async function useRedis(redisUrl: string | undefined) {
  const redis = await import("../src/lib/redis");
  await redis.closeRedis();

  if (redisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = redisUrl;

  const cache = await import("../src/lib/cache");
  const store = await import("../src/lib/rateLimitStore");
  return { redis, cache, store };
}

/** Polls a condition — connections and cache writes are asynchronous. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tests target a LOCAL Redis, deliberately not whatever REDIS_URL happens to
 * hold. .env carries the in-container hostname (redis://redis:6379), which does
 * not resolve from the host — and pointing this suite at a production Redis
 * would let it write and delete keys there.
 */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

async function run() {
  const originalUrl = process.env.REDIS_URL;

  // ---------------------------------------------------------------------
  console.log("\n--- 1. No Redis configured: the app must still work ---\n");
  // ---------------------------------------------------------------------
  {
    const { redis, cache, store } = await useRedis(undefined);

    check("getRedis() returns null when REDIS_URL is unset", redis.getRedis() === null);
    check("isRedisHealthy() is false", redis.isRedisHealthy() === false);

    let computed = 0;
    const first = await cache.cached("test:nocache", async () => {
      computed++;
      return { n: 1 };
    });
    const second = await cache.cached("test:nocache", async () => {
      computed++;
      return { n: 2 };
    });

    check("cached() returns the computed value", (first as any).n === 1);
    // The important assertion: with no cache the SECOND call must recompute. If
    // it returned the first value we would be caching in the process heap, which
    // is a correctness bug — nothing would ever invalidate it.
    check(
      "cached() recomputes every time — no accidental in-process cache",
      computed === 2 && (second as any).n === 2,
    );

    let threw = false;
    try {
      await cache.invalidate("test:");
    } catch {
      threw = true;
    }
    check("invalidate() is a no-op rather than an error", !threw);

    // Rate limiting must still function without Redis, or turning off the cache
    // would quietly turn off brute-force protection with it.
    const limiter = new store.ResilientRateLimitStore("test-nocache");
    limiter.init({ windowMs: 60_000 } as any);
    // Read the count immediately: MemoryStore returns a LIVE reference to its
    // internal client record, so holding onto the object and reading it later
    // would show the value after every subsequent increment.
    const a = (await limiter.increment("k")).totalHits;
    const b = (await limiter.increment("k")).totalHits;
    check("rate limiter still counts without Redis", a === 1 && b === 2, `${a} then ${b}`);

    await limiter.decrement("k");
    const refunded = await limiter.get("k");
    check(
      "decrement() refunds a hit (this is what skipSuccessfulRequests uses)",
      refunded?.totalHits === 1,
    );

    await limiter.resetKey("k");
    const cleared = await limiter.get("k");
    check("resetKey() clears the counter", !cleared || cleared.totalHits === 0);
    limiter.shutdown();

    await redis.closeRedis();
  }

  // ---------------------------------------------------------------------
  console.log("\n--- 2. Redis connected: caching, TTL, scoped invalidation ---\n");
  // ---------------------------------------------------------------------
  {
    const { redis, cache } = await useRedis(REDIS_URL);
    const client = redis.getRedis();
    check("getRedis() returns a client when REDIS_URL is set", client !== null);

    const ready = await waitFor(() => redis.isRedisHealthy());
    if (!ready) {
      throw new Error(
        `Could not connect to Redis at ${REDIS_URL}. Start it with: docker compose up -d redis`,
      );
    }
    check("connection reports healthy", redis.isRedisHealthy());

    // Namespaced with a timestamp so a failed run can never disturb real data.
    const stamp = Date.now();
    const k1 = `test:products:one:${stamp}`;
    const k2 = `test:products:two:${stamp}`;
    const kOther = `test:gallery:one:${stamp}`;

    let computed = 0;
    const first = await cache.cached(k1, async () => {
      computed++;
      return { hello: "world" };
    });
    // The write is deliberately not awaited inside cached() so it never delays a
    // response, which means the key may not exist for a few milliseconds.
    await sleep(200);
    const second = await cache.cached(k1, async () => {
      computed++;
      return { hello: "different" };
    });

    check("first call computes", (first as any).hello === "world" && computed === 1);
    check(
      "second call is served from cache — compute did NOT run again",
      computed === 1 && (second as any).hello === "world",
    );

    const ttl = await client!.ttl(`gsc:cache:${k1}`);
    check(
      "cached entry carries a TTL so a missed invalidation self-corrects",
      ttl > 0 && ttl <= cache.DEFAULT_TTL_SECONDS,
      `ttl=${ttl}s`,
    );

    // A short TTL must actually expire rather than being ignored.
    const kShort = `test:products:short:${stamp}`;
    let shortComputed = 0;
    await cache.cached(kShort, async () => {
      shortComputed++;
      return 1;
    }, 1);
    await sleep(1400);
    await cache.cached(kShort, async () => {
      shortComputed++;
      return 2;
    }, 1);
    check("an expired entry is recomputed", shortComputed === 2);

    await cache.cached(k2, async () => ({ v: 2 }));
    await cache.cached(kOther, async () => ({ v: 3 }));
    await sleep(200);

    await cache.invalidate("test:products:");
    const remaining: string[] = await client!.keys("gsc:cache:test:*");
    check(
      "invalidate() removed every matching key",
      !remaining.some((k) => k.includes("test:products:")),
      `${remaining.length} key(s) left`,
    );
    // The bug this catches is an over-broad invalidation — editing one product
    // wiping the gallery and CMS caches too, turning every admin save into a
    // site-wide cache stampede.
    check(
      "invalidate() left non-matching keys alone",
      remaining.some((k) => k.includes("test:gallery:")),
    );

    if (remaining.length > 0) await client!.del(...remaining);
    await redis.closeRedis();
  }

  // ---------------------------------------------------------------------
  console.log("\n--- 3. Redis unreachable: degrade, never fail ---\n");
  // ---------------------------------------------------------------------
  {
    // A port nothing is listening on simulates Redis being down far more
    // faithfully than a mock, because it exercises the real ioredis timeout,
    // retry and offline-queue behaviour — which is where the hangs live.
    const { redis, cache, store } = await useRedis("redis://127.0.0.1:6399");
    redis.getRedis();
    await sleep(800);

    let computed = 0;
    const startedAt = Date.now();
    const value = await cache.cached("test:down", async () => {
      computed++;
      return "from-postgres";
    });
    const elapsed = Date.now() - startedAt;

    check("cached() still returns the computed value", value === "from-postgres" && computed === 1);
    // enableOfflineQueue:false is what makes this true. Without it ioredis
    // buffers the command until a connection appears, so a dead Redis turns
    // every cached read into a hang rather than a fast fallback.
    check("it fails fast rather than hanging on a dead connection", elapsed < 3000, `${elapsed}ms`);

    let threw = false;
    try {
      await cache.invalidate("test:");
    } catch {
      threw = true;
    }
    check("invalidate() swallows the failure", !threw);

    const limiter = new store.ResilientRateLimitStore("test-down");
    limiter.init({ windowMs: 60_000 } as any);
    const hits: number[] = [];
    for (let i = 0; i < 3; i++) hits.push((await limiter.increment("victim")).totalHits);
    // This is the assertion ResilientRateLimitStore exists for: a Redis outage
    // must not stop the limiter counting, because express-rate-limit turns a
    // store rejection into a 500 on every rate-limited route — sign-in,
    // checkout, the contact form.
    check(
      "rate limiter keeps counting through a Redis outage",
      hits.join(",") === "1,2,3",
      hits.join(","),
    );
    limiter.shutdown();

    await redis.closeRedis();
  }

  // ---------------------------------------------------------------------
  console.log("\n--- 4. Rate limiter uses shared Redis counters when available ---\n");
  // ---------------------------------------------------------------------
  {
    const { redis, store } = await useRedis(REDIS_URL);
    redis.getRedis();
    await waitFor(() => redis.isRedisHealthy());

    const probe = new Redis(REDIS_URL);
    const key = `probe-${Date.now()}`;

    // Two stores with the SAME name stand in for two app instances behind a load
    // balancer. If counters were per-process the second would start from 1, and
    // the real allowance would be (limit x instances).
    const a = new store.ResilientRateLimitStore("test-shared");
    const b = new store.ResilientRateLimitStore("test-shared");
    a.init({ windowMs: 60_000 } as any);
    b.init({ windowMs: 60_000 } as any);

    const firstHits = (await a.increment(key)).totalHits;
    const secondHits = (await b.increment(key)).totalHits;
    check(
      "a second instance continues the same count, not its own",
      secondHits === 2,
      `${firstHits} then ${secondHits}`,
    );

    const stored = await probe.get(`gsc:rl:test-shared:${key}`);
    check("the counter really lives in Redis", stored === "2", `value=${stored}`);

    const ttl = await probe.ttl(`gsc:rl:test-shared:${key}`);
    // Without an expiry the counter would never reset and the first person to
    // hit the limit would be locked out permanently.
    check("the counter expires with the window", ttl > 0 && ttl <= 60, `ttl=${ttl}s`);

    // Separate limiters must not share a budget: a failed sign-in should not
    // consume someone's contact-form allowance.
    const other = new store.ResilientRateLimitStore("test-other");
    other.init({ windowMs: 60_000 } as any);
    const otherHits = (await other.increment(key)).totalHits;
    check("a differently-named limiter has its own counter", otherHits === 1, `${otherHits}`);

    await a.resetKey(key);
    await other.resetKey(key);
    check(
      "resetKey() clears the Redis counter",
      (await probe.get(`gsc:rl:test-shared:${key}`)) === null,
    );

    a.shutdown();
    b.shutdown();
    other.shutdown();
    await probe.quit();
    await redis.closeRedis();
  }

  // ---------------------------------------------------------------------
  console.log("\n--- 5. Nothing user-scoped may ever be cached ---\n");
  // ---------------------------------------------------------------------
  {
    // Source-level checks, because these are rules about what future code is
    // allowed to do, not about what today's code happens to return. A cache key
    // that omits the viewer's identity serves one customer's data to the next
    // person who asks — the same class of bug as the C1 audit finding.
    const cacheSource = readFileSync("src/lib/cache.ts", "utf8");
    // Comments stripped first. The prose around these keys legitimately mentions
    // orders and customers — it is there to explain why they must NOT be cached
    // — so matching against it would fail the test for saying the right thing.
    const keyBlock = cacheSource
      .slice(cacheSource.indexOf("export const cacheKeys"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const forbidden = ["order", "quote", "customer", "address", "cart", "profile", "admin"];
    const found = forbidden.filter((word) => new RegExp(`\\b${word}`, "i").test(keyBlock));
    check(
      "no cache key names a user-scoped resource",
      found.length === 0,
      found.length ? `found: ${found.join(", ")}` : "",
    );

    // Every controller calling cached() must be a PUBLIC one. An authenticated
    // controller calling cached() is exactly the failure mode above.
    const callers = execSync('grep -rl "cached(" src/controllers || true', { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const publicOnly = [
      "products.controller.ts",
      "gallery.controller.ts",
      "springTypes.controller.ts",
      "content.controller.ts",
    ];
    const unexpected = callers.filter((f) => !publicOnly.some((p) => f.endsWith(p)));
    check(
      "only public catalogue controllers call cached()",
      unexpected.length === 0,
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : `${callers.length} caller(s)`,
    );

    // Cache keys and rate-limit keys live under different namespaces, so
    // invalidating the cache can never wipe a rate-limit counter — which would
    // hand an attacker a reset button on the login limiter.
    const storeSource = readFileSync("src/lib/rateLimitStore.ts", "utf8");
    check(
      "cache and rate-limit keys use separate namespaces",
      cacheSource.includes('"gsc:cache:"') && storeSource.includes("gsc:rl:"),
    );

    // Every admin controller behind a cached read must also invalidate, or the
    // site serves the old price until the TTL expires.
    const adminWriters = ["adminProducts", "adminGallery", "adminSpringTypes", "adminContent"];
    const missing = adminWriters.filter(
      (name) => !readFileSync(`src/controllers/${name}.controller.ts`, "utf8").includes("invalidate("),
    );
    check(
      "every admin controller with cached reads invalidates on write",
      missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : "",
    );
  }

  if (originalUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalUrl;

  console.log(`\n${"=".repeat(60)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(60)}`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
