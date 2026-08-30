import express from "express";
import { requireAdminAuth } from "../middleware/adminAuth";
import { galleryImageUpload, videoUpload } from "../lib/upload";
import {
  addGalleryImage,
  deleteGalleryImage,
  addGalleryVideo,
  deleteGalleryVideo,
} from "../controllers/adminGallery.controller";

const router = express.Router();

router.use(requireAdminAuth);

router.post(
  "/images",
  (req, res, next) => {
    galleryImageUpload.single("image")(req, res, (err) => {
      if (err) {
        return res
          .status(400)
          .json({ error: err.message || "File upload failed" });
      }
      next();
    });
  },
  addGalleryImage,
);
router.delete("/images/:id", deleteGalleryImage);
router.post(
  "/videos",
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
  addGalleryVideo,
);
router.delete("/videos/:id", deleteGalleryVideo);

export default router;
