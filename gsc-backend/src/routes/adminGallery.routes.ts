import express from "express";
import { requireAdminAuth } from "../middleware/adminAuth";
import { galleryImageUpload, videoUpload, handleUpload } from "../lib/upload";
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
  handleUpload(galleryImageUpload.single("image")),
  addGalleryImage,
);
router.delete("/images/:id", deleteGalleryImage);
router.post(
  "/videos",
  handleUpload(videoUpload.single("video")),
  addGalleryVideo,
);
router.delete("/videos/:id", deleteGalleryVideo);

export default router;
