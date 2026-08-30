import { prisma } from "../db";
import { publicCustomer } from "../lib/helperFunctions";
import { isValidEgyptianPhone } from "../lib/validation";

export async function getProfile(req, res) {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.customer.id },
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
    const { name, phone } = req.body ?? {};
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
      where: { id: req.customer.id },
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
    const orders = await prisma.order.findMany({
      where: { customerId: req.customer.id },
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
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });

    if (!order || order.customerId !== req.customer.id) {
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
    const address = await prisma.address.findUnique({
      where: { customerId: req.customer.id },
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
    const existing = await prisma.address.findUnique({
      where: { customerId: req.customer.id },
    });
    if (existing) {
      return res.status(409).json({
        error:
          "You already have an address on file — use PUT to update it instead",
      });
    }

    const { fullName, phone, city, addressLine, notes } = req.body ?? {};
    if (!fullName || !phone || !city || !addressLine) {
      return res
        .status(400)
        .json({ error: "fullName, phone, city, and addressLine are required" });
    }
    if (!isValidEgyptianPhone(phone)) {
      return res.status(400).json({
        error:
          "phone must be a valid Egyptian number (e.g. 01012345678 or +201012345678)",
      });
    }

    const address = await prisma.address.create({
      data: {
        customerId: req.customer.id,
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
    const existing = await prisma.address.findUnique({
      where: { customerId: req.customer.id },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ error: "No address on file yet — create one first" });
    }

    const { fullName, phone, city, addressLine, notes } = req.body ?? {};

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
    const existing = await prisma.address.findUnique({
      where: { customerId: req.customer.id },
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
    const quotes = await prisma.quote.findMany({
      where: { customerId: req.customer.id },
      include: { _count: { select: { files: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(quotes);
  } catch (err) {
    console.error("GET /customers/me/quotes failed:", err);
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
}

export async function getQuoteDetail(req, res) {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { files: true, springType: true },
    });
    if (!quote || quote.customerId !== req.customer.id) {
      return res.status(404).json({ error: "Quote not found" });
    }
    res.json(quote);
  } catch (err) {
    console.error("GET /customers/me/quotes/:id failed:", err);
    res.status(500).json({ error: "Failed to fetch quote" });
  }
}
