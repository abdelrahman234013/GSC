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

class LastAdminError extends Error {
  status = 400;
  constructor() {
    super(
      "This would leave the system with no ADMIN accounts. Promote another " +
        "user to ADMIN first.",
    );
  }
}

/**
 * Refuses any change that would remove the final ADMIN.
 *
 * With zero admins, every route under /admin/staff becomes permanently
 * unreachable — promoting someone requires an admin, so there is no way back in
 * without editing the database by hand.
 *
 * Must run inside a transaction. The SELECT ... FOR UPDATE is the part that
 * makes it correct: without it, two admins demoting themselves at the same
 * instant would each count the other and both believe an admin remains. Locking
 * the ADMIN rows forces those transactions to take turns.
 */
async function assertAnotherAdminRemains(tx, targetAdminId: string) {
  await tx.$queryRaw`SELECT id FROM "admins" WHERE "role"::text = 'ADMIN' FOR UPDATE`;

  const remaining = await tx.admin.count({
    where: { role: "ADMIN", id: { not: targetAdminId } },
  });

  if (remaining === 0) throw new LastAdminError();
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

    const admin = await prisma.$transaction(async (tx) => {
      // Demoting an ADMIN to STAFF removes an admin just as surely as deleting
      // the account does — including when an admin demotes themselves, which
      // nothing previously prevented.
      if (role === "STAFF" && existing.role === "ADMIN") {
        await assertAnotherAdminRemains(tx, existing.id);
      }

      return tx.admin.update({
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
    });

    res.json(publicAdmin(admin));
  } catch (err) {
    if (err instanceof LastAdminError) {
      return res.status(err.status).json({ error: err.message });
    }
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

    await prisma.$transaction(async (tx) => {
      if (existing.role === "ADMIN") {
        await assertAnotherAdminRemains(tx, existing.id);
      }
      await tx.admin.delete({ where: { id: existing.id } });
    });

    res.json({ message: "Staff account removed" });
  } catch (err) {
    if (err instanceof LastAdminError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("DELETE /admin/staff/:id failed:", err);
    res.status(500).json({ error: "Failed to delete staff account" });
  }
}
