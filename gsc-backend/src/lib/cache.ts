import { getRedis } from "./redis";

// Read-through cache for PUBLIC catalogue data.
//
// WHAT MAY BE CACHED, AND WHAT MAY NOT
//
// Only responses that are identical for every visitor: the product catalogue,
// gallery, spring types, CMS pages. These are read constantly and change rarely,
// which is exactly the profile a cache is for.
//
// NEVER cache anything scoped to a user — orders, quotes, addresses, profiles.
// A cache key that omits the viewer's identity will happily serve one customer's
// order history to the next person who asks. That is the same class of bug as
// the undefined-tenant-filter issue in the audit (C1), just arrived at from a
// different direction, and it is the single most common way caching turns into a
// data breach. Everything in this module is keyed on public inputs only.

/** Namespace prefix so a FLUSH of app keys never touches rate-limiter keys. */
const PREFIX = "gsc:cache:";

/**
 * Default lifetime. Short enough that a missed invalidation self-corrects.
 *
 * The TTL is the backstop, not the mechanism: admin writes invalidate
 * immediately (see the invalidate() calls in the admin controllers), so this
 * only bounds staleness from changes made outside the API — a direct SQL edit,
 * or an invalidation that failed because Redis was briefly down.
 */
export const DEFAULT_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 300;

/**
 * Read-through cache.
 *
 * Returns the cached value when present, otherwise runs `compute`, stores the
 * result, and returns it. Every Redis interaction is wrapped: if Redis is
 * missing, slow, or broken, this degrades to simply calling `compute` — the
 * caller cannot tell the difference except in latency.
 */
export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<T> {
  const redis = getRedis();
  const fullKey = PREFIX + key;

  if (redis) {
    try {
      const hit = await redis.get(fullKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (err) {
      // A read failure is a cache miss, nothing more.
      console.error(`[cache] read failed for ${key}:`, (err as Error).message);
    }
  }

  const value = await compute();

  if (redis) {
    try {
      // Deliberately not awaited in a way that blocks the response: the caller
      // already has its answer, and a slow write should not delay it. Errors are
      // swallowed because a failed cache write is harmless.
      void redis
        .set(fullKey, JSON.stringify(value), "EX", ttlSeconds)
        .catch((err) => console.error(`[cache] write failed for ${key}:`, err.message));
    } catch (err) {
      console.error(`[cache] write failed for ${key}:`, (err as Error).message);
    }
  }

  return value;
}

/**
 * Removes every cached entry whose key starts with `prefix`.
 *
 * Uses SCAN rather than KEYS on purpose. KEYS blocks the entire Redis server
 * while it walks the whole keyspace — on a busy instance that is a stall for
 * every other client. SCAN walks in small batches and lets other commands
 * interleave.
 */
export async function invalidate(prefix: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const match = `${PREFIX}${prefix}*`;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", match, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    // A failed invalidation means stale data until the TTL expires — which is
    // why the TTL exists as a backstop. Still worth logging loudly, because
    // repeated failures mean customers see outdated prices.
    console.error(`[cache] invalidation failed for ${prefix}:`, (err as Error).message);
  }
}

/**
 * Cache key builders.
 *
 * Centralised so the keys used to WRITE and the prefixes used to INVALIDATE
 * cannot drift apart — a stale-cache bug that is genuinely hard to spot once the
 * strings are scattered across controllers.
 */
export const cacheKeys = {
  // Query parameters are part of the key: ?springType=x and ?page=2 are
  // different responses and must not share an entry. The caller passes a
  // fixed-shape object of VALIDATED values, so key order is deterministic and
  // ?page=abc collapses onto ?page=1 rather than creating a second entry.
  //
  // `search` is free text, so the key space here is technically unbounded. That
  // is bounded in practice by the TTL and by Redis running allkeys-lru, which
  // evicts the least recently used keys rather than refusing writes when the
  // memory cap is hit — see the redis service in docker-compose.
  productList: (query: Record<string, unknown>) =>
    `products:list:${JSON.stringify(query)}`,
  productDetail: (slug: string) => `products:detail:${slug}`,
  productPrefix: "products:",

  springTypes: () => "spring-types:all",
  springTypesPrefix: "spring-types:",

  gallery: (category?: string) => `gallery:${category ?? "all"}`,
  galleryPrefix: "gallery:",

  contentPage: (slug: string) => `content:page:${slug}`,
  timeline: () => "content:timeline",
  contentPrefix: "content:",
};
