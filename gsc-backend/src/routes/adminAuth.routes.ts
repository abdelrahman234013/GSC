import { Router } from "express";
import {
  login,
  logout,
  getAdminInfo,
} from "../controllers/adminAuth.controller";
import { requireAdminAuth } from "../middleware/adminAuth";

const router = Router();

router.post("/login", login);
router.post("/logout", requireAdminAuth, logout);
router.get("/me", requireAdminAuth, getAdminInfo);

export default router;
