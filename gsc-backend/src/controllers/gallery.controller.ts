import { prisma } from "../db";
import { galleryQuerySchema, parseOrFail } from "../lib/schemas";

export async function getGallery(req, res) {
  try {
    const query = parseOrFail(galleryQuerySchema, req.query, res);
    if (!query) return;

    const where: any = {};
    if (query.category) where.category = query.category;

    const [images, videos] = await Promise.all([
      prisma.galleryImage.findMany({ where, orderBy: { position: "asc" } }),
      prisma.galleryVideo.findMany({ orderBy: { position: "asc" } }),
    ]);

    res.json({ images, videos });
  } catch (err) {
    console.error("GET /gallery failed:", err);
    res.status(500).json({ error: "Failed to fetch gallery" });
  }
}
