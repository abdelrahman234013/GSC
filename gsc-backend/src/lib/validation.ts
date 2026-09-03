export function isValidEmail(email) {
  if (typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Returns "" for anything that isn't a string.
//
// This used to call .trim() unguarded, so a body like {"email": 123} threw
// "email.trim is not a function" and surfaced as a 500 from /auth/login,
// /auth/forgot-password, /auth/resend-verification and /admin/auth/login.
//
// "" is the right answer rather than throwing: no account can have an empty
// email, so callers naturally fall through to their existing "no such user"
// path — a 401 on login, the generic response on forgot-password — instead of
// needing a special case for a request that was never valid anyway.
export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export function isValidPassword(password: any) {
  if (typeof password !== "string") return false;
  if (password.length < 8) return false;
  // No bcrypt-imposed ceiling any more — passwords are SHA-256 pre-hashed before
  // hashing, so length is unlimited in practice. This cap is only to stop a
  // pathological input (a request body full of text) being run through the
  // hashing pipeline.
  if (password.length > 1024) return false;
  if (!/[0-9]/.test(password)) return false; // at least one number
  if (!/[a-zA-Z]/.test(password)) return false; // at least one letter
  return true;
}

export function isValidEgyptianPhone(phone: unknown): boolean {
  if (typeof phone !== "string") return false;
  return /^(0|\+20|0020)1[0125][0-9]{8}$/.test(phone);
}

/**
 * URL-safe slug from a name.
 *
 * Guards two ways it used to break:
 *  - a non-string input threw "text.toLowerCase is not a function" (a 500);
 *  - stripping everything outside a-z0-9 turns an Arabic-only name, or "!!!",
 *    into an empty string, which then became a product with no addressable URL.
 * Returns "" for both, and callers substitute a fallback.
 */
export function slugify(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
