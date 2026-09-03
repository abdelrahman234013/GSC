import { Router } from "express";
import {
  login,
  logout,
  getAdminInfo,
} from "../controllers/adminAuth.controller";
import { requireAdminAuth } from "../middleware/adminAuth";
import { loginIpLimiter, loginAccountLimiter } from "../middleware/rateLimit";

const router = Router();

// The highest-value target in the app: a successful guess here is full control of
// products, prices, orders and staff accounts.
router.post("/login", loginIpLimiter, loginAccountLimiter, login);
router.post("/logout", requireAdminAuth, logout);
router.get("/me", requireAdminAuth, getAdminInfo);

export default router;
