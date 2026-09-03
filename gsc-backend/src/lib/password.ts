import bcrypt from "bcrypt";
import crypto from "crypto";

// Cost 12 rather than 10. Each step doubles the work an attacker must do per
// guess; 10 was measured at ~53ms on this hardware, 12 at ~214ms. That is still
// imperceptible on a login but makes offline cracking of a stolen database four
// times more expensive.
const SALT_ROUNDS = 12;

// bcrypt silently ignores everything past 72 BYTES of input. Two different
// passwords sharing their first 72 bytes therefore hash identically — verified
// against this project's own bcrypt build, where an 87-character and a
// 99-character password were interchangeable.
//
// That byte limit bites sooner than it looks on this site: UTF-8 encodes Arabic
// characters as two bytes each, so an Arabic passphrase hits the ceiling at
// roughly 36 characters, and a user would have no idea the tail was ignored.
//
// Pre-hashing with SHA-256 folds a password of ANY length into a fixed 44-char
// base64 digest, so the whole password contributes to the result and there is no
// length limit to explain to anyone.
const SCHEME_PREFIX = "sha256$";

function prehash(plain: string): string {
  return crypto.createHash("sha256").update(plain, "utf8").digest("base64");
}

export async function hashPassword(plain: string): Promise<string> {
  const hash = await bcrypt.hash(prehash(plain), SALT_ROUNDS);
  return SCHEME_PREFIX + hash;
}

/**
 * Verifies a password against a stored hash.
 *
 * Handles both formats. Hashes written before pre-hashing was introduced are
 * plain bcrypt of the raw password and have no prefix; they keep working, so
 * nobody is locked out by this change. Reading the scheme off the stored value
 * means only ONE bcrypt comparison runs, rather than trying both and doubling
 * the cost of every failed login.
 */
export async function comparePassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (typeof plain !== "string" || typeof stored !== "string") return false;

  if (stored.startsWith(SCHEME_PREFIX)) {
    return bcrypt.compare(prehash(plain), stored.slice(SCHEME_PREFIX.length));
  }
  // Legacy hash: raw password, truncated at 72 bytes by bcrypt itself.
  return bcrypt.compare(plain, stored);
}

/** True when a stored hash predates pre-hashing and could be upgraded on next login. */
export function isLegacyPasswordHash(stored: string): boolean {
  return typeof stored === "string" && !stored.startsWith(SCHEME_PREFIX);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function compareToken(token, hash) {
  if (typeof hash !== "string") return false;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const a = Buffer.from(tokenHash);
  const b = Buffer.from(hash);
  // timingSafeEqual throws on a length mismatch, so a truncated or hand-edited
  // hash column would crash the auth path instead of just failing the check.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
