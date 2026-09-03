import { Router } from "express";
import {
  register,
  login,
  logout,
  verifyEmail,
  refreshToken,
  forgotPassword,
  resetPassword,
  google,
  getUserInfo,
} from "../controllers/customerAuth.controller";
import { requireCustomerAuth } from "../middleware/customerAuth";
import { requireTrustedOrigin } from "../middleware/csrf";
import {
  loginIpLimiter,
  loginAccountLimiter,
  emailIpLimiter,
  emailAccountLimiter,
} from "../middleware/rateLimit";
import { resendVerification } from "../controllers/customerAuth.controller";

const router = Router();

// Registration creates an account AND sends a verification email, so it is rate
// limited as an email-sending endpoint rather than a plain write.
router.post("/register", emailIpLimiter, emailAccountLimiter, register);
router.get("/verify-email", verifyEmail);
router.post("/login", loginIpLimiter, loginAccountLimiter, login);
router.post("/logout", requireCustomerAuth, logout);
// The only customer endpoint authenticated by a cookie rather than a Bearer
// token, which makes it the only one a browser will authenticate automatically
// on behalf of another site — so it needs the same CSRF guard as /admin. Every
// other route here is either public or Bearer-authenticated, and an attacker
// cannot forge an Authorization header from a cross-site page.
//
// This adds no new failure mode for legitimate browser clients: CORS already
// requires the caller's origin to be in the same allowlist before the frontend
// can read any response at all, so an origin that fails this check could never
// have used the API in the first place.
router.post("/refresh-token", requireTrustedOrigin, refreshToken);
router.post(
  "/forgot-password",
  emailIpLimiter,
  emailAccountLimiter,
  forgotPassword,
);
router.post("/reset-password", loginIpLimiter, resetPassword);
router.post("/google", google);
router.get("/me", requireCustomerAuth, getUserInfo);
router.post(
  "/resend-verification",
  emailIpLimiter,
  emailAccountLimiter,
  resendVerification,
);

export default router;
