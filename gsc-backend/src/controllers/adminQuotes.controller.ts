import { prisma } from "../db";

export async function listQuotes(req, res) {
  try {
    const { status, page, limit } = req.query;
    const where: any = {};
    if (status) where.status = status;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

    const [quotes, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        include: { springType: true },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.quote.count({ where }),
    ]);

    res.json({
      quotes,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /admin/quotes failed:", err);
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
}

export async function getQuoteDetail(req, res) {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: {
        files: true,
        springType: true,
        customer: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
    if (!quote) {
      return res.status(404).json({ error: "Quote not found" });
    }
    res.json(quote);
  } catch (err) {
    console.error("GET /admin/quotes/:id failed:", err);
    res.status(500).json({ error: "Failed to fetch quote" });
  }
}

export async function updateQuote(req, res) {
  try {
    const existing = await prisma.quote.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Quote not found" });
    }

    const { status, quotedPrice, staffNotes } = req.body ?? {};
    const validStatuses = ["PENDING", "QUOTED", "CLOSED"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }
    if (
      quotedPrice !== undefined &&
      (typeof quotedPrice !== "number" || quotedPrice < 0)
    ) {
      return res
        .status(400)
        .json({ error: "quotedPrice must be a non-negative number" });
    }

    const quote = await prisma.quote.update({
      where: { id: existing.id },
      data: { status, quotedPrice, staffNotes },
      include: { files: true, springType: true },
    });

    res.json(quote);
  } catch (err) {
    console.error("PUT /admin/quotes/:id failed:", err);
    res.status(500).json({ error: "Failed to update quote" });
  }
}
