import { prisma } from "../db";
import { listProductsQuerySchema, parseOrFail } from "../lib/schemas";
import { cached, cacheKeys } from "../lib/cache";

export async function listProducts(req, res) {
  try {
    const query = parseOrFail(listProductsQuerySchema, req.query, res);
    if (!query) return;
    const { springType, minDiameter, maxDiameter, search } = query;

    const where: any = {};

    if (springType) {
      const type = await prisma.springType.findUnique({
        where: { slug: springType },
      });
      if (!type) {
        return res.status(400).json({ error: "Unknown springType filter" });
      }
      where.springTypeId = type.id;
    }

    if (minDiameter !== undefined || maxDiameter !== undefined) {
      where.wireDiameterMm = {};
      if (minDiameter !== undefined) where.wireDiameterMm.gte = minDiameter;
      if (maxDiameter !== undefined) where.wireDiameterMm.lte = maxDiameter;
    }

    if (search) {
      where.OR = [
        { nameEn: { contains: search, mode: "insensitive" } },
        { nameAr: { contains: search, mode: "insensitive" } },
      ];
    }

    const pageNum = query.page;
    const limitNum = query.limit;

    const payload = await cached(
      cacheKeys.productList({
        springType,
        minDiameter,
        maxDiameter,
        search,
        page: pageNum,
        limit: limitNum,
      }),
      async () => {
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

        return {
          products,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        };
      },
    );

    res.json(payload);
  } catch (err) {
    console.error("GET /products failed:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
}

export async function getProductBySlug(req, res) {
  try {
    const product = await cached(cacheKeys.productDetail(req.params.slug), () =>
      prisma.product.findUnique({
        where: { slug: req.params.slug },
        include: {
          images: { orderBy: { position: "asc" } },
          springType: true,
        },
      }),
    );
    if (!product) {
      // A miss is cached as null too, which is deliberate: without it, requests
      // for a non-existent slug would hit the database every single time — the
      // classic "cache penetration" pattern a scraper can exploit to bypass the
      // cache entirely just by requesting random slugs.
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
    const payload = await cached(cacheKeys.springTypes(), async () => {
      const [springTypes, range] = await Promise.all([
        prisma.springType.findMany({ orderBy: { nameEn: "asc" } }),
        prisma.product.aggregate({
          _min: { wireDiameterMm: true },
          _max: { wireDiameterMm: true },
        }),
      ]);

      return {
        springTypes,
        diameterRange: {
          min: range._min.wireDiameterMm,
          max: range._max.wireDiameterMm,
        },
      };
    });

    res.json(payload);
  } catch (err) {
    console.error("GET /product-categories failed:", err);
    res.status(500).json({ error: "Failed to fetch product categories" });
  }
}
