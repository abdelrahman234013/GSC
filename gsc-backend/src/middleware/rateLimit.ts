import { rateLimit, ipKeyGenerator } from "express-rate-limit";

// Rate limiting for the endpoints where unlimited requests are actually harmful:
// password guessing, outbound email, and order creation.
//
// STORE: these use the default in-memory store, which is correct for a single
// instance but has two limits worth knowing. Counters live in this process, so
// they reset on every deploy or restart, and if you ever run more than one
// instance each keeps its own counts — an attacker's effective allowance
// multiplies by the number of instances. Swapping to Redis when you get there is
// a one-line change per limiter:
//
//   import { RedisStore } from "rate-limit-redis";
//   ... rateLimit({ store: new RedisStore({ ... }), ... })
//
// TRUST PROXY: per-IP limiting only works if req.ip is the real client IP. See
// the TRUST_PROXY note in src/index.ts — without it every request behind your
// host's proxy shares one bucket and a single limit would lock out all customers
// simultaneously.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function tooMany(message: string) {
  return { error: message };
}

/**
 * Keys a limiter by the account being targeted rather than by who is asking.
 *
 * Per-IP limits alone don't stop a distributed attack on one account — a botnet
 * gets a fresh bucket per source address. Keying on the submitted email means all
 * attempts against one account share a budget no matter where they come from.
 *
 * Falls back to the IP when no usable email was submitted, so malformed requests
 * don't all pile into a single shared bucket.
 */
function accountKey(req: any): string {
  const email = req.body?.email;
  if (typeof email !== "string" || email.trim().length === 0) {
    return `ip:${ipKeyGenerator(req.ip)}`;
  }
  return `account:${email.trim().toLowerCase()}`;
}

/**
 * Loose catch-all so a single source can't hammer the whole API.
 *
 * Deliberately generous. Egyptian mobile networks make heavy use of CGNAT, so a
 * large number of genuine customers can share one public IP — an aggressive
 * global cap would lock out an entire carrier's users at once. The strict limits
 * belong on the specific endpoints below, not here.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany("Too many requests. Please slow down and try again shortly."),
});

/**
 * Password guessing, keyed by source IP.
 *
 * skipSuccessfulRequests means only FAILED attempts count, so someone who logs in
 * normally is never penalised — which is what makes a limit this tight safe even
 * on a shared/CGNAT address.
 */
export const loginIpLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany(
    "Too many failed sign-in attempts. Please wait 15 minutes and try again.",
  ),
});

/** Password guessing, keyed by the targeted account. Stops distributed attacks. */
export const loginAccountLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: accountKey,
  validate: { ip: false }, // keyed by account, not IP — silence the IPv6 check
  message: tooMany(
    "Too many failed sign-in attempts for this account. Please wait 15 minutes and try again.",
  ),
});

/**
 * Anything that causes us to send an email.
 *
 * Each request here costs real money and, more importantly, sending reputation:
 * a flood of mail to addresses that never asked for it is how a domain ends up
 * in spam folders permanently. It can also be aimed at a third party's inbox,
 * which makes us the abuser rather than the victim.
 */
export const emailIpLimiter = rateLimit({
  windowMs: HOUR,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany(
    "Too many requests. Please wait a while before requesting another email.",
  ),
});

/** Same, keyed by the recipient address, so one inbox can't be flooded. */
export const emailAccountLimiter = rateLimit({
  windowMs: HOUR,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: accountKey,
  validate: { ip: false },
  message: tooMany(
    "Too many requests for this email address. Please wait a while and try again.",
  ),
});

/**
 * Public contact form. Unauthenticated, and every submission emails every admin —
 * without a limit it is an open relay pointed at your own staff's inboxes.
 */
export const contactLimiter = rateLimit({
  windowMs: HOUR,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany(
    "Too many messages sent. Please wait a while before sending another.",
  ),
});

/**
 * Order creation, keyed by customer rather than IP.
 *
 * Every order decrements real stock and dispatches a real van, and the route is
 * authenticated, so the account is the meaningful identity here — an attacker
 * changing IP shouldn't get a fresh allowance. Set high enough that no genuine
 * shopper will ever reach it.
 */
export const checkoutLimiter = rateLimit({
  windowMs: HOUR,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) =>
    req.customer?.id ? `customer:${req.customer.id}` : `ip:${ipKeyGenerator(req.ip)}`,
  validate: { ip: false },
  message: tooMany(
    "Too many orders placed in a short time. Please contact us if you need to place a large order.",
  ),
});

/** RFQ submission — authenticated, sends email, and accepts file uploads. */
export const quoteLimiter = rateLimit({
  windowMs: HOUR,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) =>
    req.customer?.id ? `customer:${req.customer.id}` : `ip:${ipKeyGenerator(req.ip)}`,
  validate: { ip: false },
  message: tooMany(
    "Too many quote requests in a short time. Please wait a while and try again.",
  ),
});
