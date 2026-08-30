import { prisma } from "../db";

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createSpringType(req, res) {
  try {
    const { nameAr, nameEn, slug } = req.body ?? {};
    if (!nameAr || !nameEn) {
      return res.status(400).json({ error: "nameAr and nameEn are required" });
    }

    const finalSlug = slug ? slugify(slug) : slugify(nameEn);
    const existing = await prisma.springType.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      return res.status(409).json({ error: "A spring type with this slug already exists" });
    }

    const springType = await prisma.springType.create({
      data: { nameAr, nameEn, slug: finalSlug },
    });

    res.status(201).json(springType);
  } catch (err) {
    console.error("POST /admin/spring-types failed:", err);
    res.status(500).json({ error: "Failed to create spring type" });
  }
}

export async function updateSpringType(req, res) {
  try {
    const existing = await prisma.springType.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: "Spring type not found" });
    }

    const { nameAr, nameEn, slug } = req.body ?? {};

    let finalSlug = slug;
    if (slug !== undefined) {
      finalSlug = slugify(slug);
      const clash = await prisma.springType.findUnique({ where: { slug: finalSlug } });
      if (clash && clash.id !== existing.id) {
        return res.status(409).json({ error: "A spring type with this slug already exists" });
      }
    }

    const springType = await prisma.springType.update({
      where: { id: existing.id },
      data: { nameAr, nameEn, slug: finalSlug },
    });

    res.json(springType);
  } catch (err) {
    console.error("PUT /admin/spring-types/:id failed:", err);
    res.status(500).json({ error: "Failed to update spring type" });
  }
}

export async function deleteSpringType(req, res) {
  try {
    const existing = await prisma.springType.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: "Spring type not found" });
    }

    await prisma.springType.delete({ where: { id: existing.id } });
    res.json({ message: "Spring type removed" });
  } catch (err) {
    if (err.code === "P2003") {
      return res.status(409).json({
        error: "Cannot delete a spring type that's still used by existing products",
      });
    }
    console.error("DELETE /admin/spring-types/:id failed:", err);
    res.status(500).json({ error: "Failed to delete spring type" });
  }
}
