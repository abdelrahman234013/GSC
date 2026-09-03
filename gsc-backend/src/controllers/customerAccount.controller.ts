import { prisma } from "../db";
import {
  publicCustomer,
  publicQuote,
  resolveCustomerId,
} from "../lib/helperFunctions";
import { signQuoteFiles } from "../lib/supabaseStorage";
import {
  profileUpdateSchema,
  addressSchema,
  addressUpdateSchema,
  parseOrFail,
} from "../lib/schemas";
import { isValidEgyptianPhone } from "../lib/validation";

export async function getProfile(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(publicCustomer(customer));
  } catch (err) {
    console.error("GET /customers/me failed:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function updateProfile(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const parsed = parseOrFail(profileUpdateSchema, req.body ?? {}, res);
    if (!parsed) return;
    const { name, phone } = parsed;

    if (name === undefined && phone === undefined) {
      return res
        .status(400)
        .json({ error: "Provide at least name or phone to update" });
    }

    if (phone !== undefined && !isValidEgyptianPhone(phone)) {
      return res.status(400).json({
        error:
          "phone must be a valid Egyptian number (e.g. 01012345678 or +201012345678)",
      });
    }

    const customer = await prisma.customer.update({
      where: { id: customerId },
      data: { name, phone },
    });
    res.json(publicCustomer(customer));
  } catch (err) {
    console.error("PUT /customers/me failed:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function getOrders(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const orders = await prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    });

    const result = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      itemCount: order._count.items,
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /customers/me/orders failed:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
}

export async function getOrderDetail(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });

    if (!order || order.customerId !== customerId) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(order);
  } catch (err) {
    console.error("GET /customers/me/orders/:id failed:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
}

export async function getAddress(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const address = await prisma.address.findUnique({
      where: { customerId },
    });
    if (!address) {
      return res.status(404).json({ error: "No address on file yet" });
    }
    res.json(address);
  } catch (err) {
    console.error("GET /customers/me/address failed:", err);
    res.status(500).json({ error: "Failed to fetch address" });
  }
}

export async function createAddress(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const existing = await prisma.address.findUnique({
      where: { customerId },
    });
    if (existing) {
      return res.status(409).json({
        error:
          "You already have an address on file — use PUT to update it instead",
      });
    }

    const parsed = parseOrFail(addressSchema, req.body ?? {}, res);
    if (!parsed) return;
    const { fullName, phone, city, addressLine, notes } = parsed;

    if (!isValidEgyptianPhone(phone)) {
      return res.status(400).json({
        error:
          "phone must be a valid Egyptian number (e.g. 01012345678 or +201012345678)",
      });
    }

    const address = await prisma.address.create({
      data: {
        customerId,
        fullName,
        phone,
        city,
        addressLine,
        notes,
      },
    });
    res.status(201).json(address);
  } catch (err) {
    console.error("POST /customers/me/address failed:", err);
    res.status(500).json({ error: "Failed to create address" });
  }
}

export async function updateAddress(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const existing = await prisma.address.findUnique({
      where: { customerId },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ error: "No address on file yet — create one first" });
    }

    const parsed = parseOrFail(addressUpdateSchema, req.body ?? {}, res);
    if (!parsed) return;
    const { fullName, phone, city, addressLine, notes } = parsed;

    if (phone !== undefined && !isValidEgyptianPhone(phone)) {
      return res.status(400).json({
        error:
          "phone must be a valid Egyptian number (e.g. 01012345678 or +201012345678)",
      });
    }
    const address = await prisma.address.update({
      where: { id: existing.id },
      data: {
        fullName: fullName ?? existing.fullName,
        phone: phone ?? existing.phone,
        city: city ?? existing.city,
        addressLine: addressLine ?? existing.addressLine,
        notes: notes ?? existing.notes,
      },
    });
    res.json(address);
  } catch (err) {
    console.error("PUT /customers/me/address failed:", err);
    res.status(500).json({ error: "Failed to update address" });
  }
}

export async function deleteAddress(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const existing = await prisma.address.findUnique({
      where: { customerId },
    });
    if (!existing) {
      return res.status(404).json({ error: "No address on file" });
    }
    await prisma.address.delete({ where: { id: existing.id } });
    res.json({ message: "Address removed" });
  } catch (err) {
    console.error("DELETE /customers/me/address failed:", err);
    res.status(500).json({ error: "Failed to delete address" });
  }
}

export async function getQuotes(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const quotes = await prisma.quote.findMany({
      where: { customerId },
      include: { _count: { select: { files: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(quotes.map(publicQuote));
  } catch (err) {
    console.error("GET /customers/me/quotes failed:", err);
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
}

export async function getQuoteDetail(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { files: true, springType: true },
    });
    if (!quote || quote.customerId !== customerId) {
      return res.status(404).json({ error: "Quote not found" });
    }
    res.json({
      ...publicQuote(quote),
      files: await signQuoteFiles(quote.files),
    });
  } catch (err) {
    console.error("GET /customers/me/quotes/:id failed:", err);
    res.status(500).json({ error: "Failed to fetch quote" });
  }
}
