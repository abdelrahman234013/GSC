import { prisma } from "../db";
import { sendEmail } from "../lib/mailer";
import {
  orderConfirmationEmail,
  newOrderAdminEmail,
} from "../lib/emailTemplates";

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
  try {
    const customerId = req.customer.id;

    const { items, notes } = req.body ?? {};

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
      let totalAmount = 0;
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

        totalAmount += Number(product.price) * item.quantity;

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

    try {
      if (order.contactEmail) {
        const msg = orderConfirmationEmail(order);
        await sendEmail(order.contactEmail, msg.subject, msg.html);
      }
      const admins = await prisma.admin.findMany({ select: { email: true } });
      const adminMsg = newOrderAdminEmail(order);
      await Promise.all(
        admins.map((a) => sendEmail(a.email, adminMsg.subject, adminMsg.html)),
      );
    } catch (emailErr) {
      console.error("Order placed but notification email(s) failed:", emailErr);
    }

    res.status(201).json({ orderNumber: order.orderNumber, order });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("POST /checkout failed:", err);
    res.status(500).json({ error: "Failed to place order" });
  }
}
