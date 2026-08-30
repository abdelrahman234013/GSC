import express from "express";
import { requireAdminAuth } from "../middleware/adminAuth";
import {
  listQuotes,
  getQuoteDetail,
  updateQuote,
} from "../controllers/adminQuotes.controller";

const router = express.Router();

router.use(requireAdminAuth); // no role check — Staff can manage RFQs too

router.get("/", listQuotes);
router.get("/:id", getQuoteDetail);
router.put("/:id", updateQuote);

export default router;
