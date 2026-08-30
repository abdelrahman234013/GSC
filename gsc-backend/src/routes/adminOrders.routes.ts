import express from "express";
import { requireAdminAuth } from "../middleware/adminAuth";
import {
  listOrders,
  getOrderDetail,
  updateOrderStatus,
} from "../controllers/adminOrders.controller";

const router = express.Router();

router.use(requireAdminAuth); // no role check — Staff can manage orders too, per the spec

router.get("/", listOrders);
router.get("/:id", getOrderDetail);
router.put("/:id/status", updateOrderStatus);

export default router;
