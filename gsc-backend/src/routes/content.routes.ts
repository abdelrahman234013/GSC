import express from "express";
import { getPage, getTimeline } from "../controllers/content.controller";

const router = express.Router();

router.get("/content/pages/:slug", getPage);
router.get("/content/timeline", getTimeline);

export default router;
