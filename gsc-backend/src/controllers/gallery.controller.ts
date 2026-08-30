import { prisma } from "../db";

export async function getGallery(req, res) {
  try {
    const { category } = req.query;
    const where: any = {};
    if (category) where.category = category;

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
