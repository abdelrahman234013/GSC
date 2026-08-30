import express from "express";
import { requireAdminAuth } from "../middleware/adminAuth";
import {
  updatePage,
  createTimelineEntry,
  updateTimelineEntry,
  deleteTimelineEntry,
  uploadHeroVideo,
} from "../controllers/adminContent.controller";
import { videoUpload } from "../lib/upload";

const router = express.Router();

router.use(requireAdminAuth);

router.put("/pages/:slug", updatePage);
router.post("/timeline", createTimelineEntry);
router.put("/timeline/:id", updateTimelineEntry);
router.delete("/timeline/:id", deleteTimelineEntry);
router.post(
  "/home/hero-video",
  (req, res, next) => {
    videoUpload.single("video")(req, res, (err) => {
      if (err) {
        return res
          .status(400)
          .json({ error: err.message || "File upload failed" });
      }
      next();
    });
  },
  uploadHeroVideo,
);

export default router;
