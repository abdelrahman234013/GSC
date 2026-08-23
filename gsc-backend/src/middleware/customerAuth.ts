import { verifyToken } from "../lib/jwt";

const CUSTOMER_JWT_SECRET = process.env.CUSTOMER_JWT_SECRET;

export function requireCustomerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyToken(token, CUSTOMER_JWT_SECRET);
    req.customer = { id: payload.userId };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
