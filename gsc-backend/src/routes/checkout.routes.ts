import express from "express";
import { createOrder } from "../controllers/checkout.controller";
import { requireCustomerAuth } from "../middleware/customerAuth";

const router = express.Router();

router.post("/checkout", requireCustomerAuth, createOrder);

export default router;
