import { prisma } from "../db";
import { uploadToSupabase } from "../lib/supabaseStorage";

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function generateUniqueSlug(base) {
  let slug = slugify(base);
  let suffix = 1;
  while (await prisma.product.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${slugify(base)}-${suffix}`;
  }
  return slug;
}

export async function createProduct(req, res) {
  try {
    const {
      nameAr,
      nameEn,
      descriptionAr,
      descriptionEn,
      springTypeId,
      wireDiameterMm,
      outerDiameterMm,
      innerDiameterMm,
      lengthMm,
      materialAr,
      materialEn,
      price,
      stock,
      metaTitleAr,
      metaTitleEn,
      metaDescriptionAr,
      metaDescriptionEn,
      slug,
    } = req.body ?? {};

    if (
      !nameAr ||
      !nameEn ||
      !springTypeId ||
      wireDiameterMm === undefined ||
      !materialAr ||
      !materialEn ||
      price === undefined
    ) {
      return res.status(400).json({
        error:
          "nameAr, nameEn, springTypeId, wireDiameterMm, materialAr, materialEn, and price are required",
      });
    }

    const type = await prisma.springType.findUnique({
      where: { id: springTypeId },
    });
    if (!type) {
      return res
        .status(400)
        .json({ error: "springTypeId does not match an existing spring type" });
    }

    let finalSlug;
    if (slug) {
      finalSlug = slugify(slug);
      const clash = await prisma.product.findUnique({
        where: { slug: finalSlug },
      });
      if (clash) {
        return res
          .status(409)
          .json({ error: "A product with this slug already exists" });
      }
    } else {
      finalSlug = await generateUniqueSlug(nameEn);
    }

    const product = await prisma.product.create({
      data: {
        slug: finalSlug,
        nameAr,
        nameEn,
        descriptionAr,
        descriptionEn,
        springTypeId,
        wireDiameterMm,
        outerDiameterMm,
        innerDiameterMm,
        lengthMm,
        materialAr,
        materialEn,
        price,
        stock: stock ?? 0,
        metaTitleAr,
        metaTitleEn,
        metaDescriptionAr,
        metaDescriptionEn,
      },
      include: { springType: true },
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("POST /admin/products failed:", err);
    res.status(500).json({ error: "Failed to create product" });
  }
}

export async function updateProduct(req, res) {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Product not found" });
    }

    const {
      nameAr,
      nameEn,
      descriptionAr,
      descriptionEn,
      springTypeId,
      wireDiameterMm,
      outerDiameterMm,
      innerDiameterMm,
      lengthMm,
      materialAr,
      materialEn,
      price,
      stock,
      stockDelta,
      metaTitleAr,
      metaTitleEn,
      metaDescriptionAr,
      metaDescriptionEn,
      slug,
    } = req.body ?? {};

    if (springTypeId !== undefined) {
      const type = await prisma.springType.findUnique({
        where: { id: springTypeId },
      });
      if (!type) {
        return res.status(400).json({
          error: "springTypeId does not match an existing spring type",
        });
      }
    }

    if (price !== undefined && (typeof price !== "number" || price < 0)) {
      return res
        .status(400)
        .json({ error: "price must be a non-negative number" });
    }

    if (stock !== undefined && stockDelta !== undefined) {
      return res
        .status(400)
        .json({ error: "Provide only one of stock or stockDelta, not both" });
    }
    if (stock !== undefined && (typeof stock !== "number" || stock < 0)) {
      return res
        .status(400)
        .json({ error: "stock must be a non-negative number" });
    }
    if (stockDelta !== undefined && typeof stockDelta !== "number") {
      return res.status(400).json({ error: "stockDelta must be a number" });
    }

    let finalSlug = slug;
    if (slug !== undefined) {
      finalSlug = slugify(slug);
      const clash = await prisma.product.findUnique({
        where: { slug: finalSlug },
      });
      if (clash && clash.id !== existing.id) {
        return res
          .status(409)
          .json({ error: "A product with this slug already exists" });
      }
    }

    const product = await prisma.product.update({
      where: { id: existing.id },
      data: {
        nameAr,
        nameEn,
        descriptionAr,
        descriptionEn,
        springTypeId,
        wireDiameterMm,
        outerDiameterMm,
        innerDiameterMm,
        lengthMm,
        materialAr,
        materialEn,
        price,
        stock: stockDelta !== undefined ? { increment: stockDelta } : stock,
        metaTitleAr,
        metaTitleEn,
        metaDescriptionAr,
        metaDescriptionEn,
        slug: finalSlug,
      },
      include: { springType: true },
    });

    if (product.stock < 0) {
      const fixed = await prisma.product.update({
        where: { id: existing.id },
        data: { stock: 0 },
        include: { springType: true },
      });
      return res.json(fixed);
    }

    res.json(product);
  } catch (err) {
    console.error("PUT /admin/products/:id failed:", err);
    res.status(500).json({ error: "Failed to update product" });
  }
}

export async function deleteProduct(req, res) {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Product not found" });
    }

    await prisma.product.delete({ where: { id: existing.id } });
    res.json({ message: "Product removed" });
  } catch (err) {
    if (err.code === "P2003") {
      return res.status(409).json({
        error:
          "Cannot delete a product that's referenced by existing orders or carts",
      });
    }
    console.error("DELETE /admin/products/:id failed:", err);
    res.status(500).json({ error: "Failed to delete product" });
  }
}

export async function addProductImages(req, res) {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
    });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one image file is required" });
    }

    const uploaded = await Promise.all(
      req.files.map((f) => uploadToSupabase("product-images", f)),
    );

    const existingCount = await prisma.productImage.count({
      where: { productId: product.id },
    });

    await prisma.productImage.createMany({
      data: uploaded.map((img, i) => ({
        productId: product.id,
        url: img.url,
        position: existingCount + i,
      })),
    });

    const allImages = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
    });

    res.status(201).json(allImages);
  } catch (err) {
    console.error("POST /admin/products/:id/images failed:", err);
    res.status(500).json({ error: "Failed to add product images" });
  }
}
