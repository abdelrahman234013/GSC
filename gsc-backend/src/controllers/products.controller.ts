import { prisma } from "../db";

export async function listProducts(req, res) {
  try {
    const { springType, minDiameter, maxDiameter, search, page, limit } = req.query;

    const where: any = {};

    if (springType) {
      const type = await prisma.springType.findUnique({ where: { slug: springType } });
      if (!type) {
        return res.status(400).json({ error: "Unknown springType filter" });
      }
      where.springTypeId = type.id;
    }

    if (minDiameter || maxDiameter) {
      where.wireDiameterMm = {};
      if (minDiameter) where.wireDiameterMm.gte = Number(minDiameter);
      if (maxDiameter) where.wireDiameterMm.lte = Number(maxDiameter);
    }

    if (search) {
      where.OR = [
        { nameEn: { contains: search, mode: "insensitive" } },
        { nameAr: { contains: search, mode: "insensitive" } },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          images: { orderBy: { position: "asc" } },
          springType: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /products failed:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
}

export async function getProductBySlug(req, res) {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
      include: {
        images: { orderBy: { position: "asc" } },
        springType: true,
      },
    });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product);
  } catch (err) {
    console.error("GET /products/:slug failed:", err);
    res.status(500).json({ error: "Failed to fetch product" });
  }
}

export async function getProductCategories(req, res) {
  try {
    const [springTypes, range] = await Promise.all([
      prisma.springType.findMany({ orderBy: { nameEn: "asc" } }),
      prisma.product.aggregate({
        _min: { wireDiameterMm: true },
        _max: { wireDiameterMm: true },
      }),
    ]);

    res.json({
      springTypes,
      diameterRange: {
        min: range._min.wireDiameterMm,
        max: range._max.wireDiameterMm,
      },
    });
  } catch (err) {
    console.error("GET /product-categories failed:", err);
    res.status(500).json({ error: "Failed to fetch product categories" });
  }
}
