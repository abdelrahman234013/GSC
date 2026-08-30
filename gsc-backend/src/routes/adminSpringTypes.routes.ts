import { Router } from "express";
import {
  createSpringType,
  updateSpringType,
  deleteSpringType,
} from "../controllers/adminSpringTypes.controller";
import { requireAdminAuth } from "../middleware/adminAuth";

const router = Router();

router.use(requireAdminAuth);

router.post("/", createSpringType);
router.put("/:id", updateSpringType);
router.delete("/:id", deleteSpringType);

export default router;
