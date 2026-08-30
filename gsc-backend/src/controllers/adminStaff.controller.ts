import { prisma } from "../db";
import { hashPassword } from "../lib/password";
import {
  isValidPassword,
  isValidEmail,
  normalizeEmail,
} from "../lib/validation";

function publicAdmin(admin) {
  const { passwordHash, sessionTokenHash, ...safe } = admin;
  return safe;
}

export async function listStaff(req, res) {
  try {
    const staff = await prisma.admin.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(staff);
  } catch (err) {
    console.error("GET /admin/staff failed:", err);
    res.status(500).json({ error: "Failed to fetch staff accounts" });
  }
}

export async function createStaff(req, res) {
  try {
    const { email, password, name, role } = req.body ?? {};
    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ error: "email, password, and name are required" });
    }

    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({ error: "Please enter a valid email address" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters and contain at least one letter and one number",
      });
    }

    if (role && role !== "ADMIN" && role !== "STAFF") {
      return res.status(400).json({ error: "role must be ADMIN or STAFF" });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await prisma.admin.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const admin = await prisma.admin.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name,
        role: role || "STAFF",
      },
    });

    res.status(201).json(publicAdmin(admin));
  } catch (err) {
    console.error("POST /admin/staff failed:", err);
    res.status(500).json({ error: "Failed to create staff account" });
  }
}

export async function updateStaff(req, res) {
  try {
    const existing = await prisma.admin.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Staff account not found" });
    }

    const { name, role, password } = req.body ?? {};

    if (role !== undefined && role !== "ADMIN" && role !== "STAFF") {
      return res.status(400).json({ error: "role must be ADMIN or STAFF" });
    }

    let passwordHash;
    if (password !== undefined) {
      if (!isValidPassword(password)) {
        return res.status(400).json({
          error:
            "Password must be at least 8 characters and contain at least one letter and one number",
        });
      }
      passwordHash = await hashPassword(password);
    }

    const admin = await prisma.admin.update({
      where: { id: existing.id },
      data: {
        name,
        role,
        passwordHash,
        // Changing the password kills their current session too — same
        // idea as customer resetPassword nulling refreshTokenHash.
        sessionTokenHash: password !== undefined ? null : undefined,
      },
    });

    res.json(publicAdmin(admin));
  } catch (err) {
    console.error("PUT /admin/staff/:id failed:", err);
    res.status(500).json({ error: "Failed to update staff account" });
  }
}

export async function deleteStaff(req, res) {
  try {
    const existing = await prisma.admin.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Staff account not found" });
    }

    // Stop an admin from deleting their own account through this endpoint —
    // avoids accidentally locking everyone out with no admins left.
    if (existing.id === req.admin.id) {
      return res
        .status(400)
        .json({ error: "You can't delete your own account" });
    }

    await prisma.admin.delete({ where: { id: existing.id } });
    res.json({ message: "Staff account removed" });
  } catch (err) {
    console.error("DELETE /admin/staff/:id failed:", err);
    res.status(500).json({ error: "Failed to delete staff account" });
  }
}
