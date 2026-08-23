import bcrypt from "bcrypt";
import crypto from "crypto";

const SALT_ROUNDS = 10;

export function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function compareToken(token, hash) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(tokenHash), Buffer.from(hash));
}
