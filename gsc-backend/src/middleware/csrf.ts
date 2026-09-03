import { getTrustedOrigins } from "../lib/origins";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireTrustedOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const trusted = getTrustedOrigins();

  let candidate = req.headers.origin;
  if (!candidate && req.headers.referer) {
    try {
      candidate = new URL(req.headers.referer).origin;
    } catch {
      candidate = undefined;
    }
  }

  if (!candidate || !trusted.includes(candidate)) {
    return res.status(403).json({ error: "Request origin not allowed" });
  }

  next();
}
