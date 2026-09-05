import { prisma } from "../db";
import { invalidate, cacheKeys } from "../lib/cache";
import {
  uploadToSupabase,
  removeFromSupabase,
  UploadError,
} from "../lib/supabaseStorage";
import { cleanupStagedFiles } from "../lib/upload";
import { IMAGE_TYPES } from "../lib/fileTypes";
import { slugify } from "../lib/validation";
import {
  createProductSchema,
  updateProductSchema,
  parseOrFail,
} from "../lib/schemas";

async function generateUniqueSlug(base) {
  // A bilingual catalogue makes empty slugs likely, not hypothetical: slugify
  // strips everything outside a-z0-9, so an Arabic-only nameEn yields "". A
  // product with an empty slug is unreachable at /products/:slug, so fall back
  // to something addressable.
  const root = slugify(base) || "product";
  let slug = root;
  let suffix = 1;
  while (await prisma.product.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${root}-${suffix}`;
  }
  return slug;
}

export async function createProduct(req, res) {
  try {
    // Same schema the update path uses, so the two can't disagree about what a
    // valid product is. The old check here only tested for PRESENCE, which is why
    // `price: -500` was refused on update but accepted on create.
    const body = parseOrFail(createProductSchema, req.body ?? {}, res);
    if (!body) return;

    const {
      nameEn,
      springTypeId,
      slug,
      stock,
      ...rest
    } = body;

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
      // An explicit slug that sanitises to nothing (e.g. Arabic-only) would
      // otherwise be stored as "", leaving the product unaddressable.
      finalSlug = slugify(slug);
      if (!finalSlug) {
        return res
          .status(400)
          .json({ error: "slug must contain at least one letter or number" });
      }
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
        ...rest,
        slug: finalSlug,
        nameEn,
        springTypeId,
        stock: stock ?? 0,
      },
      include: { springType: true },
    });

    await invalidate(cacheKeys.productPrefix);
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

    const body = parseOrFail(updateProductSchema, req.body ?? {}, res);
    if (!body) return;

    const { springTypeId, slug, stock, stockDelta, ...rest } = body;

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

    let finalSlug = slug;
    if (slug !== undefined) {
      finalSlug = slugify(slug);
      if (!finalSlug) {
        return res
          .status(400)
          .json({ error: "slug must contain at least one letter or number" });
      }
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
        ...rest,
        springTypeId,
        stock: stockDelta !== undefined ? { increment: stockDelta } : stock,
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
      await invalidate(cacheKeys.productPrefix);
      return res.json(fixed);
    }

    await invalidate(cacheKeys.productPrefix);
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
      include: { images: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Read the image URLs BEFORE the delete: ProductImage rows cascade away with
    // the product, and once they're gone there is no record of which stored
    // objects belonged to it.
    const imageUrls = existing.images.map((img) => img.url);

    await prisma.product.delete({ where: { id: existing.id } });

    // After the row is gone, so a storage hiccup can't fail a delete that already
    // succeeded in the database.
    await removeFromSupabase("product-images", imageUrls);

    await invalidate(cacheKeys.productPrefix);
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

export async function deleteProductImage(req, res) {
  try {
    const image = await prisma.productImage.findUnique({
      where: { id: req.params.imageId },
    });
    // Checking the parent too, so an image id from another product can't be
    // deleted through a URL that claims it belongs to this one.
    if (!image || image.productId !== req.params.id) {
      return res.status(404).json({ error: "Product image not found" });
    }

    await prisma.productImage.delete({ where: { id: image.id } });
    await removeFromSupabase("product-images", [image.url]);

    // Close the gap left in the ordering so positions stay 0,1,2… rather than
    // developing holes that make a later reorder confusing.
    const remaining = await prisma.productImage.findMany({
      where: { productId: image.productId },
      orderBy: { position: "asc" },
    });
    await prisma.$transaction(
      remaining.map((img, index) =>
        prisma.productImage.update({
          where: { id: img.id },
          data: { position: index },
        }),
      ),
    );

    await invalidate(cacheKeys.productPrefix);
    res.json({ message: "Product image removed" });
  } catch (err) {
    console.error("DELETE /admin/products/:id/images/:imageId failed:", err);
    res.status(500).json({ error: "Failed to delete product image" });
  }
}

export async function reorderProductImages(req, res) {
  try {
    const { imageIds } = req.body ?? {};
    if (!Array.isArray(imageIds) || imageIds.some((id) => typeof id !== "string")) {
      return res
        .status(400)
        .json({ error: "imageIds must be an array of image ids, in display order" });
    }

    const images = await prisma.productImage.findMany({
      where: { productId: req.params.id },
    });
    if (images.length === 0) {
      return res.status(404).json({ error: "Product has no images" });
    }

    // Require the full set: a partial list would leave the unlisted images with
    // stale positions, silently producing an order the admin did not ask for.
    const existingIds = new Set(images.map((i) => i.id));
    const givenIds = new Set(imageIds);
    if (
      givenIds.size !== imageIds.length ||
      imageIds.length !== images.length ||
      imageIds.some((id) => !existingIds.has(id))
    ) {
      return res.status(400).json({
        error:
          "imageIds must list every image of this product exactly once, in the order you want",
      });
    }

    await prisma.$transaction(
      imageIds.map((id, index) =>
        prisma.productImage.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    const updated = await prisma.productImage.findMany({
      where: { productId: req.params.id },
      orderBy: { position: "asc" },
    });
    await invalidate(cacheKeys.productPrefix);
    res.json(updated);
  } catch (err) {
    console.error("PUT /admin/products/:id/images/reorder failed:", err);
    res.status(500).json({ error: "Failed to reorder product images" });
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
      req.files.map((f) => uploadToSupabase("product-images", f, IMAGE_TYPES)),
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

    await invalidate(cacheKeys.productPrefix);
    res.status(201).json(allImages);
  } catch (err) {
    if (err instanceof UploadError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("POST /admin/products/:id/images failed:", err);
    res.status(500).json({ error: "Failed to add product images" });
  } finally {
    await cleanupStagedFiles(req);
  }
}
