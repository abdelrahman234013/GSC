import express from "express";
import { createOrder } from "../controllers/checkout.controller";
import { requireCustomerAuth } from "../middleware/customerAuth";
import { checkoutLimiter } from "../middleware/rateLimit";

const router = express.Router();

// Limiter sits after auth so it can key on the customer id rather than the IP.
router.post("/checkout", requireCustomerAuth, checkoutLimiter, createOrder);

export default router;
