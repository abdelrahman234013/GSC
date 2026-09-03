import express from "express";
import { submitContact } from "../controllers/contact.controller";
import { contactLimiter } from "../middleware/rateLimit";

const router = express.Router();
router.post("/contact", contactLimiter, submitContact);
export default router;
