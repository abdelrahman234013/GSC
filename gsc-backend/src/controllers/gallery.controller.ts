import { prisma } from "../db";
import { galleryQuerySchema, parseOrFail } from "../lib/schemas";
import { cached, cacheKeys } from "../lib/cache";

export async function getGallery(req, res) {
  try {
    const query = parseOrFail(galleryQuerySchema, req.query, res);
    if (!query) return;

    const where: any = {};
    if (query.category) where.category = query.category;

    const payload = await cached(cacheKeys.gallery(query.category), async () => {
      const [images, videos] = await Promise.all([
        prisma.galleryImage.findMany({ where, orderBy: { position: "asc" } }),
        prisma.galleryVideo.findMany({ orderBy: { position: "asc" } }),
      ]);
      return { images, videos };
    });

    res.json(payload);
  } catch (err) {
    console.error("GET /gallery failed:", err);
    res.status(500).json({ error: "Failed to fetch gallery" });
  }
}
