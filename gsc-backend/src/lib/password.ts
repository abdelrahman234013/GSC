import bcrypt from "bcrypt";
import crypto from "crypto";

const SALT_ROUNDS = 12;

const SCHEME_PREFIX = "sha256$";

function prehash(plain: string): string {
  return crypto.createHash("sha256").update(plain, "utf8").digest("base64");
}

export async function hashPassword(plain: string): Promise<string> {
  const hash = await bcrypt.hash(prehash(plain), SALT_ROUNDS);
  return SCHEME_PREFIX + hash;
}

export async function comparePassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (typeof plain !== "string" || typeof stored !== "string") return false;

  if (stored.startsWith(SCHEME_PREFIX)) {
    return bcrypt.compare(prehash(plain), stored.slice(SCHEME_PREFIX.length));
  }

  return bcrypt.compare(plain, stored);
}

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

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
