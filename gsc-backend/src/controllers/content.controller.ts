import { prisma } from "../db";
import { cached, cacheKeys } from "../lib/cache";

export async function getPage(req, res) {
  try {
    const page = await cached(cacheKeys.contentPage(req.params.slug), () =>
      prisma.contentPage.findUnique({ where: { slug: req.params.slug } }),
    );
    if (!page) {
      return res.status(404).json({ error: "Page not found" });
    }
    res.json(page);
  } catch (err) {
    console.error("GET /content/pages/:slug failed:", err);
    res.status(500).json({ error: "Failed to fetch page" });
  }
}

export async function getTimeline(req, res) {
  try {
    const entries = await cached(cacheKeys.timeline(), () =>
      prisma.timelineEntry.findMany({ orderBy: { position: "asc" } }),
    );
    res.json(entries);
  } catch (err) {
    console.error("GET /content/timeline failed:", err);
    res.status(500).json({ error: "Failed to fetch timeline" });
  }
}
