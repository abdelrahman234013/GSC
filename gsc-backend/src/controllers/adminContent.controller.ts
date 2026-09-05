import { prisma } from "../db";
import { invalidate, cacheKeys } from "../lib/cache";
import { uploadToSupabase, UploadError } from "../lib/supabaseStorage";
import { cleanupStagedFiles } from "../lib/upload";
import { VIDEO_TYPES } from "../lib/fileTypes";

const ALLOWED_SLUGS = [
  "home",
  "about",
  "products-capabilities",
  "contact",
  "gallery",
];

export async function updatePage(req, res) {
  try {
    const { slug } = req.params;
    if (!ALLOWED_SLUGS.includes(slug)) {
      return res
        .status(400)
        .json({ error: `slug must be one of: ${ALLOWED_SLUGS.join(", ")}` });
    }

    const {
      titleAr,
      titleEn,
      bodyAr,
      bodyEn,
      metaTitleAr,
      metaTitleEn,
      metaDescriptionAr,
      metaDescriptionEn,
    } = req.body ?? {};
    if (bodyAr === undefined || bodyEn === undefined) {
      return res.status(400).json({ error: "bodyAr and bodyEn are required" });
    }

    const page = await prisma.contentPage.upsert({
      where: { slug },
      update: {
        titleAr,
        titleEn,
        bodyAr,
        bodyEn,
        metaTitleAr,
        metaTitleEn,
        metaDescriptionAr,
        metaDescriptionEn,
      },
      create: {
        slug,
        titleAr,
        titleEn,
        bodyAr,
        bodyEn,
        metaTitleAr,
        metaTitleEn,
        metaDescriptionAr,
        metaDescriptionEn,
      },
    });

    await invalidate(cacheKeys.contentPrefix);
    res.json(page);
  } catch (err) {
    console.error("PUT /admin/content/pages/:slug failed:", err);
    res.status(500).json({ error: "Failed to update page" });
  }
}

export async function createTimelineEntry(req, res) {
  try {
    const { year, titleAr, titleEn, descriptionAr, descriptionEn, position } =
      req.body ?? {};
    if (!year || !titleAr || !titleEn) {
      return res
        .status(400)
        .json({ error: "year, titleAr, and titleEn are required" });
    }

    const entry = await prisma.timelineEntry.create({
      data: {
        year: Number(year),
        titleAr,
        titleEn,
        descriptionAr,
        descriptionEn,
        position: position ?? 0,
      },
    });
    await invalidate(cacheKeys.contentPrefix);
    res.status(201).json(entry);
  } catch (err) {
    console.error("POST /admin/content/timeline failed:", err);
    res.status(500).json({ error: "Failed to create timeline entry" });
  }
}

export async function updateTimelineEntry(req, res) {
  try {
    const existing = await prisma.timelineEntry.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Timeline entry not found" });
    }

    const { year, titleAr, titleEn, descriptionAr, descriptionEn, position } =
      req.body ?? {};
    const entry = await prisma.timelineEntry.update({
      where: { id: existing.id },
      data: {
        year: year !== undefined ? Number(year) : existing.year,
        titleAr: titleAr ?? existing.titleAr,
        titleEn: titleEn ?? existing.titleEn,
        descriptionAr: descriptionAr ?? existing.descriptionAr,
        descriptionEn: descriptionEn ?? existing.descriptionEn,
        position: position ?? existing.position,
      },
    });
    await invalidate(cacheKeys.contentPrefix);
    res.json(entry);
  } catch (err) {
    console.error("PUT /admin/content/timeline/:id failed:", err);
    res.status(500).json({ error: "Failed to update timeline entry" });
  }
}

export async function deleteTimelineEntry(req, res) {
  try {
    const existing = await prisma.timelineEntry.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Timeline entry not found" });
    }
    await prisma.timelineEntry.delete({ where: { id: existing.id } });
    await invalidate(cacheKeys.contentPrefix);
    res.json({ message: "Timeline entry removed" });
  } catch (err) {
    console.error("DELETE /admin/content/timeline/:id failed:", err);
    res.status(500).json({ error: "Failed to delete timeline entry" });
  }
}

export async function uploadHeroVideo(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "A video file is required" });
    }

    const uploaded = await uploadToSupabase(
      "content-videos",
      req.file,
      VIDEO_TYPES,
    );

    const existing = await prisma.contentPage.findUnique({
      where: { slug: "home" },
    });
    const existingBodyAr =
      existing?.bodyAr && typeof existing.bodyAr === "object"
        ? (existing.bodyAr as Record<string, unknown>)
        : {};
    const existingBodyEn =
      existing?.bodyEn && typeof existing.bodyEn === "object"
        ? (existing.bodyEn as Record<string, unknown>)
        : {};
    const bodyAr = { ...existingBodyAr, heroVideoUrl: uploaded.url };
    const bodyEn = { ...existingBodyEn, heroVideoUrl: uploaded.url };

    const page = await prisma.contentPage.upsert({
      where: { slug: "home" },
      update: { bodyAr, bodyEn },
      create: { slug: "home", bodyAr, bodyEn },
    });

    await invalidate(cacheKeys.contentPrefix);
    res.status(201).json(page);
  } catch (err) {
    if (err instanceof UploadError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("POST /admin/content/home/hero-video failed:", err);
    res.status(500).json({ error: "Failed to upload hero video" });
  } finally {
    await cleanupStagedFiles(req);
  }
}
