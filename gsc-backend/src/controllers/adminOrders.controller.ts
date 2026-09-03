import { prisma } from "../db";
import { notifyCustomer } from "../lib/notifications";
import { listOrdersQuerySchema, parseOrFail } from "../lib/schemas";
import { orderStatusUpdateEmail } from "../lib/emailTemplates";

export async function listOrders(req, res) {
  try {
    const query = parseOrFail(listOrdersQuerySchema, req.query, res);
    if (!query) return;

    const where: any = {};
    if (query.status) where.status = query.status;

    const pageNum = query.page;
    const limitNum = query.limit;

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

// Which statuses an order may move to from where it is now.
//
// Previously ANY transition was accepted, including DELIVERED -> PROCESSING,
// which let a delivered order silently reappear as unfulfilled work. Fulfilment
// runs one way; the only sideways move is cancelling.
//
// CANCELLED is terminal on purpose. Un-cancelling would have to re-decrement
// stock, which can fail if the items have since been sold to someone else —
// leaving an order that is neither cancelled nor fulfillable. If a cancellation
// was a mistake, the clean answer is a new order.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PROCESSING: ["SHIPPING", "DELIVERED", "CANCELLED"],
  SHIPPING: ["DELIVERED", "CANCELLED"],
  // A delivery refused at the door, or returned afterwards.
  DELIVERED: ["CANCELLED"],
  CANCELLED: [],
};

export async function updateOrderStatus(req, res) {
  try {
    const existing = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Order not found" });
    }

    const { status, cancellationReason } = req.body ?? {};
    const validStatuses = Object.keys(ALLOWED_TRANSITIONS);
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    if (status === existing.status) {
      return res.json(existing); // no-op, and must not restore stock twice
    }

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(status)) {
      return res.status(409).json({
        error:
          `An order that is ${existing.status} cannot become ${status}.` +
          (allowed.length
            ? ` Allowed from here: ${allowed.join(", ")}.`
            : " This order is in a final state."),
      });
    }

    const order = await prisma.$transaction(async (tx) => {
      // Cancelling returns the goods to sellable stock. Done inside the same
      // transaction as the status change so the two can never disagree — and
      // only on the transition INTO cancelled, which the equality check above
      // guarantees happens at most once per order.
      if (status === "CANCELLED") {
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      return tx.order.update({
        where: { id: existing.id },
        data: {
          status,
          cancelledAt: status === "CANCELLED" ? new Date() : undefined,
          cancellationReason:
            status === "CANCELLED"
              ? typeof cancellationReason === "string" &&
                cancellationReason.trim().length > 0
                ? cancellationReason.trim().slice(0, 500)
                : null
              : undefined,
        },
        include: { items: true },
      });
    });

    // Status is saved; the customer notification goes out after the response so
    // an admin clicking "mark as shipped" never waits on the mail provider.
    notifyCustomer(
      order.contactEmail,
      orderStatusUpdateEmail(order),
      `order ${order.orderNumber} status -> ${order.status}`,
    );

    res.json(order);
  } catch (err) {
    console.error("PUT /admin/orders/:id/status failed:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
}
