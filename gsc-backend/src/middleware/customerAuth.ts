import { verifyToken, TOKEN_PURPOSE } from "../lib/jwt";

// Read at call time, not import time. Capturing process.env into a module-level
// const freezes whatever was set when this file was first imported, which makes
// correctness depend on dotenv loading before the module graph does.
export function requireCustomerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyToken(
      token,
      process.env.CUSTOMER_JWT_SECRET,
      TOKEN_PURPOSE.CUSTOMER_ACCESS,
    );
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // A valid signature is not enough — the token has to actually identify someone.
  // Without this, a token carrying no userId would authenticate with an id of
  // undefined, and Prisma reads an undefined filter as "no filter at all", which
  // turns every per-customer query into a query over the whole table.
  if (typeof payload?.userId !== "string" || payload.userId.length === 0) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.customer = { id: payload.userId };
  // Deliberately outside the try above: next() runs the rest of the request, and
  // anything it throws must not be mistaken here for a bad token.
  next();
}
