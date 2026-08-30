import { Router } from "express";
import {
  getProfile,
  updateProfile,
  getOrders,
  getOrderDetail,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
  getQuotes,
  getQuoteDetail,
} from "../controllers/customerAccount.controller";
import { requireCustomerAuth } from "../middleware/customerAuth";

const router = Router();

router.use(requireCustomerAuth);

router.get("/me", getProfile);
router.put("/me", updateProfile);
router.get("/me/orders", getOrders);
router.get("/me/orders/:id", getOrderDetail);
router.get("/me/address", getAddress);
router.post("/me/address", createAddress);
router.put("/me/address", updateAddress);
router.delete("/me/address", deleteAddress);
router.get("/me/quotes", getQuotes);
router.get("/me/quotes/:id", getQuoteDetail);

export default router;
