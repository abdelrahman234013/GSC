import { prisma } from "../db";
import { hashPassword, comparePassword, hashToken } from "../lib/password";
import {
  signToken,
  setAdminSessionCookie,
  clearAdminSessionCookie,
} from "../lib/jwt";
import { normalizeEmail } from "../lib/validation";

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

function publicAdmin(admin) {
  const { passwordHash, sessionTokenHash, ...safe } = admin;
  return safe;
}

export async function login(req, res) {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const admin = await prisma.admin.findUnique({
      where: { email: normalizedEmail },
    });
    if (!admin) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await comparePassword(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken({ adminId: admin.id }, ADMIN_JWT_SECRET, "8h");
    const sessionTokenHash = hashToken(token);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { sessionTokenHash },
    });

    setAdminSessionCookie(res, token);
    res.json({ admin: publicAdmin(admin) });
  } catch (err) {
    console.error("POST /admin/auth/login failed:", err);
    res.status(500).json({ error: "Failed to log in" });
  }
}

export async function logout(req, res) {
  try {
    await prisma.admin.update({
      where: { id: req.admin.id },
      data: { sessionTokenHash: null },
    });
    clearAdminSessionCookie(res);
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("POST /admin/auth/logout failed:", err);
    res.status(500).json({ error: "Failed to log out" });
  }
}

export async function getAdminInfo(req, res) {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.id },
    });
    if (!admin) {
      return res.status(404).json({ error: "Admin not found" });
    }
    res.json(publicAdmin(admin));
  } catch (err) {
    console.error("GET /admin/auth/me failed:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}
