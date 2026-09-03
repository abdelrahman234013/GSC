import express from "express";
import { submitQuote } from "../controllers/quotes.controller";
import { requireCustomerAuth } from "../middleware/customerAuth";
import { quoteUpload, handleUpload } from "../lib/upload";
import { quoteLimiter } from "../middleware/rateLimit";

const router = express.Router();

router.post(
  "/quotes",
  requireCustomerAuth,
  // Before the upload middleware, so a flood is rejected without staging files.
  quoteLimiter,
  handleUpload(quoteUpload.array("files", 5)),
  submitQuote,
);

export default router;
