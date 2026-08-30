import { prisma } from "../db";
import { uploadToSupabase } from "../lib/supabaseStorage";

const VALID_CATEGORIES = [
  "FACTORY_INTERIOR",
  "MACHINES",
  "FINISHED_PRODUCT",
  "MANUFACTURING_PROCESS",
];

export async function addGalleryImage(req, res) {
  try {
    const { category, captionAr, captionEn, altAr, altEn, position } =
      req.body ?? {};
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({
          error: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
        });
    }
    if (!req.file) {
      return res.status(400).json({ error: "An image file is required" });
    }

    const uploaded = await uploadToSupabase("gallery-images", req.file);

    const image = await prisma.galleryImage.create({
      data: {
        url: uploaded.url,
        category,
        captionAr,
        captionEn,
        altAr,
        altEn,
        position: position ? Number(position) : 0,
      },
    });

    res.status(201).json(image);
  } catch (err) {
    console.error("POST /admin/gallery/images failed:", err);
    res.status(500).json({ error: "Failed to add gallery image" });
  }
}

export async function deleteGalleryImage(req, res) {
  try {
    const existing = await prisma.galleryImage.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Gallery image not found" });
    }
    await prisma.galleryImage.delete({ where: { id: existing.id } });
    res.json({ message: "Gallery image removed" });
  } catch (err) {
    console.error("DELETE /admin/gallery/images/:id failed:", err);
    res.status(500).json({ error: "Failed to delete gallery image" });
  }
}

export async function addGalleryVideo(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "A video file is required" });
    }

    const { titleAr, titleEn, position } = req.body ?? {};

    const uploaded = await uploadToSupabase("content-videos", req.file);

    const video = await prisma.galleryVideo.create({
      data: {
        url: uploaded.url,
        titleAr,
        titleEn,
        position: position ? Number(position) : 0,
      },
    });

    res.status(201).json(video);
  } catch (err) {
    console.error("POST /admin/gallery/videos failed:", err);
    res.status(500).json({ error: "Failed to add gallery video" });
  }
}

export async function deleteGalleryVideo(req, res) {
  try {
    const existing = await prisma.galleryVideo.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Gallery video not found" });
    }
    await prisma.galleryVideo.delete({ where: { id: existing.id } });
    res.json({ message: "Gallery video removed" });
  } catch (err) {
    console.error("DELETE /admin/gallery/videos/:id failed:", err);
    res.status(500).json({ error: "Failed to delete gallery video" });
  }
}
