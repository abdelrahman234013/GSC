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
import { resendVerification } from "../controllers/customerAuth.controller";

const router = Router();

router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/login", login);
router.post("/logout", requireCustomerAuth, logout);
router.post("/refresh-token", refreshToken);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/google", google);
router.get("/me", requireCustomerAuth, getUserInfo);
router.post("/resend-verification", resendVerification);

export default router;
