import { Router } from "express";
import {
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
} from "../controllers/adminStaff.controller";
import { requireAdminAuth, requireAdminRole } from "../middleware/adminAuth";

const router = Router();

// Every route here needs a logged-in Admin specifically, not just any staff.
router.use(requireAdminAuth, requireAdminRole);

router.get("/", listStaff);
router.post("/", createStaff);
router.put("/:id", updateStaff);
router.delete("/:id", deleteStaff);

export default router;
