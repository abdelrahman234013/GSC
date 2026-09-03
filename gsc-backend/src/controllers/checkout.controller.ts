import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
import { notifyCustomer, notifyAdmins } from "../lib/notifications";
import {
  orderConfirmationEmail,
  newOrderAdminEmail,
} from "../lib/emailTemplates";
import { resolveCustomerId } from "../lib/helperFunctions";
import { checkoutNotesSchema } from "../lib/schemas";

class CheckoutError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function generateOrderNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let orderNumber;
  do {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    orderNumber = `GSC-${datePart}-${suffix}`;
  } while (await prisma.order.findUnique({ where: { orderNumber } }));
  return orderNumber;
}

export async function createOrder(req, res) {
  // Declared outside the try so the catch below can still see them when it needs
  // to resolve a concurrent-retry collision.
  const customerId = resolveCustomerId(req, res);
  if (!customerId) return;

  // Idempotency-Key lets a client retry a checkout safely. A double-click, a
  // dropped mobile connection, or an automatic retry would otherwise place a
  // second real order and decrement stock twice — for cash on delivery, two
  // vans to one address and a customer billed for goods they never ordered.
  //
  // Optional: an order placed without a key simply has no retry protection.
  // For the frontend, generate ONE key (crypto.randomUUID()) when the customer
  // opens the checkout page and send that same value on every attempt for that
  // basket — a fresh key per attempt provides no protection at all.
  const rawKey =
    req.get?.("Idempotency-Key") ?? req.headers?.["idempotency-key"];
  const idempotencyKey =
    typeof rawKey === "string" && rawKey.trim().length > 0
      ? rawKey.trim().slice(0, 200)
      : null;

  try {
    if (idempotencyKey) {
      const replay = await prisma.order.findUnique({
        where: {
          customerId_idempotencyKey: { customerId, idempotencyKey },
        },
        include: { items: true },
      });
      if (replay) {
        // Same key, same customer — this is a retry of an order that already
        // exists. Return it unchanged instead of creating a second one.
        return res
          .status(200)
          .json({ orderNumber: replay.orderNumber, order: replay, replayed: true });
      }
    }

    const { items, notes: rawNotes } = req.body ?? {};

    const notesParsed = checkoutNotesSchema.safeParse(rawNotes ?? undefined);
    if (!notesParsed.success) {
      return res
        .status(400)
        .json({ error: "notes must be text of at most 1000 characters" });
    }
    const notes = notesParsed.data ?? null;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "items must be a non-empty array of { productId, quantity }",
      });
    }
    for (const item of items) {
      if (
        !item.productId ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        return res.status(400).json({
          error: "Each item needs a productId and a positive integer quantity",
        });
      }
    }

    const address = await prisma.address.findUnique({ where: { customerId } });
    if (!address) {
      return res
        .status(400)
        .json({ error: "Add a delivery address before checking out" });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { email: true },
    });

    const orderNumber = await generateOrderNumber();

    const order = await prisma.$transaction(async (tx) => {
      // Money is accumulated as a Decimal, never a JavaScript number.
      //
      // `Number(price) * qty` looks harmless but binary floating point cannot
      // represent most decimal fractions exactly: 0.1 * 3 is 0.30000000000000004,
      // and 0.1 added ten times is 0.9999999999999999. Small baskets round back to
      // the right answer when written into Decimal(10,2), which is exactly what
      // makes this dangerous — it works until one day a total doesn't match the
      // sum of its own line items, and you find out during a customer dispute.
      let totalAmount = new Prisma.Decimal(0);
      const orderItemsData = [];

      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });
        if (!product) {
          throw new CheckoutError(
            400,
            `Product ${item.productId} does not exist`,
          );
        }
        if (product.stock < item.quantity) {
          throw new CheckoutError(
            409,
            `${product.nameEn} is out of stock (only ${product.stock} left)`,
          );
        }

        const decremented = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (decremented.count === 0) {
          throw new CheckoutError(409, `${product.nameEn} is out of stock`);
        }

        // Derived from priceSnapshot — the exact value stored on the line item —
        // so the order total is the sum of its items by construction, not by
        // coincidence.
        const lineTotal = new Prisma.Decimal(product.price).mul(item.quantity);
        totalAmount = totalAmount.plus(lineTotal);

        orderItemsData.push({
          productId: product.id,
          nameSnapshotAr: product.nameAr,
          nameSnapshotEn: product.nameEn,
          priceSnapshot: product.price,
          quantity: item.quantity,
        });
      }

      return tx.order.create({
        data: {
          orderNumber,
          customerId,
          idempotencyKey,
          contactName: address.fullName,
          contactPhone: address.phone,
          contactEmail: customer?.email ?? null,
          city: address.city,
          addressLine: address.addressLine,
          notes,
          totalAmount,
          items: { create: orderItemsData },
        },
        include: { items: true },
      });
    });

    // Fire-and-forget: the order is already committed, so telling people about it
    // must not hold the response open. Previously a slow Resend call kept the HTTP
    // connection AND a database pool slot occupied for the duration.
    notifyCustomer(
      order.contactEmail,
      orderConfirmationEmail(order),
      `order confirmation ${order.orderNumber}`,
    );
    notifyAdmins(newOrderAdminEmail(order), `new order ${order.orderNumber}`);

    res.status(201).json({ orderNumber: order.orderNumber, order });
  } catch (err: any) {
    if (err instanceof CheckoutError) {
      return res.status(err.status).json({ error: err.message });
    }

    // The pre-check above catches sequential retries, but two requests sent at
    // the same instant can both find nothing and both try to insert. The unique
    // index is what actually decides it: one insert wins, the other fails here
    // with P2002. That is the intended path, not an error — return the order the
    // winner created.
    //
    // The losing transaction rolled back in full, so its stock decrements were
    // undone too; stock is only ever reduced once.
    const target = Array.isArray(err?.meta?.target) ? err.meta.target : [];
    if (err?.code === "P2002" && target.includes("idempotencyKey")) {
      const winner = await prisma.order.findUnique({
        where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
        include: { items: true },
      });
      if (winner) {
        return res.status(200).json({
          orderNumber: winner.orderNumber,
          order: winner,
          replayed: true,
        });
      }
    }

    console.error("POST /checkout failed:", err);
    res.status(500).json({ error: "Failed to place order" });
  }
}
