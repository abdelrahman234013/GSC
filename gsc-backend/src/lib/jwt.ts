import jwt from "jsonwebtoken";
import crypto from "crypto";

// Every token this app issues is bound to exactly one purpose. The signing key is
// derived from the base secret and the purpose, so a token minted for one purpose
// can never verify as another — even if a caller forgets to check a claim.
export const TOKEN_PURPOSE = {
  CUSTOMER_ACCESS: "customer:access",
  CUSTOMER_REFRESH: "customer:refresh",
  EMAIL_VERIFICATION: "customer:email-verification",
  PASSWORD_RESET: "customer:password-reset",
  ADMIN_SESSION: "admin:session",
};

function keyFor(baseSecret, purpose) {
  if (typeof baseSecret !== "string" || baseSecret.length === 0) {
    throw new Error(`Missing JWT secret for token purpose "${purpose}"`);
  }
  if (typeof purpose !== "string" || purpose.length === 0) {
    throw new Error("signToken/verifyToken requires a token purpose");
  }
  return crypto.createHmac("sha256", baseSecret).update(purpose).digest();
}

export function signToken(payload, secret, expiresIn, purpose) {
  return jwt.sign(payload, keyFor(secret, purpose), {
    expiresIn,
    audience: purpose,
  });
}

// Throws on anything that isn't a valid, unexpired token of this exact purpose.
// It must throw rather than return null: callers read fields straight off the
// payload, and a null here would surface as a confusing 500 — or worse, as an
// undefined id flowing into a database filter.
export function verifyToken(token, secret, purpose) {
  const payload: any = jwt.verify(token, keyFor(secret, purpose), {
    audience: purpose,
  });
  return payload;
}

// Default deployment shape is frontend + API on one registrable domain
// (app.example.com + api.example.com), which is same-site and keeps
// SameSite=Lax — the strongest setting that still works cross-subdomain.
// Set COOKIE_CROSS_SITE=true only if the frontend and API end up on different
// registrable domains (e.g. a frontend on Vercel and an API on Render). Read at
// call time, not captured into a module-level const at import time, so
// correctness never depends on dotenv having run before this module first loads.
//
// SameSite=None is rejected by browsers unless Secure is also set, and there's
// no meaningful "cross-site over plain http" case anyway — a cross-site cookie
// needs HTTPS to work at all — so cross-site mode forces Secure regardless of
// NODE_ENV.
//
// Flipping this on is safe specifically because requireTrustedOrigin
// (src/middleware/csrf.ts) is mounted unconditionally on every admin route,
// not gated behind this flag — so the CSRF coverage this cookie change removes
// is already in place before you ever need to turn it on.
function cookieSecurity() {
  const crossSite = process.env.COOKIE_CROSS_SITE === "true";
  return {
    sameSite: crossSite ? ("none" as const) : ("lax" as const),
    secure: crossSite || process.env.NODE_ENV === "production",
  };
}

export function setRefreshCookie(res, refreshToken) {
  const { sameSite, secure } = cookieSecurity();
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/auth/refresh-token", // only sent to this one endpoint, not every request
    maxAge: 5 * 24 * 60 * 60 * 1000, // keep this in sync with the "5d" refresh token expiry
  });
}

export function setAdminSessionCookie(res, token) {
  const { sameSite, secure } = cookieSecurity();
  res.cookie("adminSession", token, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/admin",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  });
}

export function clearRefreshCookie(res) {
  // clearCookie must mirror the secure/sameSite the cookie was set with —
  // some browsers won't overwrite a Secure cookie with a clear that isn't
  // also Secure, so a stale refresh cookie could otherwise survive logout.
  const { sameSite, secure } = cookieSecurity();
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure,
    sameSite,
    path: "/auth/refresh-token",
  });
}

export function clearAdminSessionCookie(res) {
  const { sameSite, secure } = cookieSecurity();
  res.clearCookie("adminSession", {
    httpOnly: true,
    secure,
    sameSite,
    path: "/admin",
  });
}
