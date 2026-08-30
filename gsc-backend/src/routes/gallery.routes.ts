import express from "express";
import { getGallery } from "../controllers/gallery.controller";

const router = express.Router();
router.get("/gallery", getGallery);
export default router;
