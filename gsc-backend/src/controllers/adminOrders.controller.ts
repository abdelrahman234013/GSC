import { prisma } from "../db";
import { sendEmail } from "../lib/mailer";
import { orderStatusUpdateEmail } from "../lib/emailTemplates";

export async function listOrders(req, res) {
  try {
    const { status, page, limit } = req.query;
    const where: any = {};
    if (status) where.status = status;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /admin/orders failed:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
}

export async function getOrderDetail(req, res) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        customer: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(order);
  } catch (err) {
    console.error("GET /admin/orders/:id failed:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
}

export async function updateOrderStatus(req, res) {
  try {
    const existing = await prisma.order.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Order not found" });
    }

    const { status } = req.body ?? {};
    const validStatuses = ["PROCESSING", "SHIPPING", "DELIVERED"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const order = await prisma.order.update({
      where: { id: existing.id },
      data: { status },
      include: { items: true },
    });

    if (order.contactEmail) {
      try {
        const msg = orderStatusUpdateEmail(order);
        await sendEmail(order.contactEmail, msg.subject, msg.html);
      } catch (emailErr) {
        console.error("Order status updated but email failed:", emailErr);
      }
    }

    res.json(order);
  } catch (err) {
    console.error("PUT /admin/orders/:id/status failed:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
}
