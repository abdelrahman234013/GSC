import { prisma } from "../db";

export async function listSpringTypes(req, res) {
  try {
    const springTypes = await prisma.springType.findMany({
      orderBy: { nameEn: "asc" },
    });
    res.json(springTypes);
  } catch (err) {
    console.error("GET /spring-types failed:", err);
    res.status(500).json({ error: "Failed to fetch spring types" });
  }
}
