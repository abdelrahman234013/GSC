import express from "express";
import { submitQuote } from "../controllers/quotes.controller";
import { requireCustomerAuth } from "../middleware/customerAuth";
import { quoteUpload } from "../lib/upload";

const router = express.Router();

router.post(
  "/quotes",
  requireCustomerAuth,
  (req, res, next) => {
    quoteUpload.array("files", 5)(req, res, (err) => {
      if (err) {
        return res
          .status(400)
          .json({ error: err.message || "File upload failed" });
      }
      next();
    });
  },
  submitQuote,
);

export default router;
