import express from "express";
import { requireAdminAuth } from "../middleware/adminAuth";
import {
  updatePage,
  createTimelineEntry,
  updateTimelineEntry,
  deleteTimelineEntry,
  uploadHeroVideo,
} from "../controllers/adminContent.controller";
import { videoUpload, handleUpload } from "../lib/upload";

const router = express.Router();

router.use(requireAdminAuth);

router.put("/pages/:slug", updatePage);
router.post("/timeline", createTimelineEntry);
router.put("/timeline/:id", updateTimelineEntry);
router.delete("/timeline/:id", deleteTimelineEntry);
router.post(
  "/home/hero-video",
  handleUpload(videoUpload.single("video")),
  uploadHeroVideo,
);

export default router;
