import { verifyToken } from "../lib/jwt";
import { prisma } from "../db";
import { compareToken } from "../lib/password";

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

export async function requireAdminAuth(req, res, next) {
  const token = req.cookies?.adminSession;
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const payload = verifyToken(token, ADMIN_JWT_SECRET);
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
    });

    if (
      !admin?.sessionTokenHash ||
      !compareToken(token, admin.sessionTokenHash)
    ) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.admin = { id: admin.id, role: admin.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function requireAdminRole(req, res, next) {
  if (req.admin?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
