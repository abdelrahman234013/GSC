import { verifyToken, TOKEN_PURPOSE } from "../lib/jwt";
import { prisma } from "../db";
import { compareToken } from "../lib/password";

// Read at call time, not import time — see the note in customerAuth.ts.
export async function requireAdminAuth(req, res, next) {
  const token = req.cookies?.adminSession;
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }

  let payload;
  try {
    payload = verifyToken(
      token,
      process.env.ADMIN_JWT_SECRET,
      TOKEN_PURPOSE.ADMIN_SESSION,
    );
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Same reasoning as requireCustomerAuth: a signed token that names nobody must
  // never be allowed to reach a database lookup.
  if (typeof payload?.adminId !== "string" || payload.adminId.length === 0) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  try {
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
  } catch (err) {
    console.error("Admin session check failed:", err);
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  next();
}

export function requireAdminRole(req, res, next) {
  if (req.admin?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
