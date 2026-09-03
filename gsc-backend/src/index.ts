import "dotenv/config";
import "./lib/env";
import express from "express";
import customerAuthRoutes from "./routes/customerAuth.routes";
import cookieParser from "cookie-parser";
import cors from "cors";
import { getTrustedOrigins } from "./lib/origins";
import { requireTrustedOrigin } from "./middleware/csrf";
import { globalLimiter } from "./middleware/rateLimit";
import { prisma } from "./db";
import customerAccountRoutes from "./routes/customerAccount.routes";
import adminAuthRoutes from "./routes/adminAuth.routes";
import adminStaffRoutes from "./routes/adminStaff.routes";
import productsRoutes from "./routes/products.routes";
import adminProductsRoutes from "./routes/adminProducts.routes";
import springTypesRoutes from "./routes/springTypes.routes";
import adminSpringTypesRoutes from "./routes/adminSpringTypes.routes";
import checkoutRoutes from "./routes/checkout.routes";
import adminOrdersRoutes from "./routes/adminOrders.routes";
import quotesRoutes from "./routes/quotes.routes";
import adminQuotesRoutes from "./routes/adminQuotes.routes";
import contentRoutes from "./routes/content.routes";
import adminContentRoutes from "./routes/adminContent.routes";
import galleryRoutes from "./routes/gallery.routes";
import adminGalleryRoutes from "./routes/adminGallery.routes";
import contactRoutes from "./routes/contact.routes";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const trustedOrigins = getTrustedOrigins();
if (trustedOrigins.length === 0) {
  console.error(
    "FATAL: no trusted browser origin configured. Set FRONTEND_URL (and " +
      "optionally ALLOWED_ORIGINS). Without it, CORS and the admin CSRF check " +
      "reject every browser request.",
  );
  process.exit(1);
}

const trustProxy = process.env.TRUST_PROXY?.trim();

if (trustProxy) {
  if (/^(true|false|yes|no)$/i.test(trustProxy)) {
    console.error(
      `FATAL: TRUST_PROXY="${trustProxy}" is not valid. Use the NUMBER of proxies ` +
        `in front of this app (e.g. TRUST_PROXY=1), or leave it unset if the app ` +
        `is reachable directly. "true" would trust any client-supplied ` +
        `X-Forwarded-For header and disable rate limiting entirely.`,
    );
    process.exit(1);
  }

  const hops = Number(trustProxy);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
    console.error(
      `FATAL: TRUST_PROXY="${trustProxy}" must be a whole number between 1 and 10 ` +
        `(the count of proxies in front of this app).`,
    );
    process.exit(1);
  }

  app.set("trust proxy", hops);
  console.log(`Trusting ${hops} proxy hop(s) for client IP resolution.`);
} else if (process.env.NODE_ENV === "production") {
  console.warn(
    "WARNING: TRUST_PROXY is not set in production. If a reverse proxy sits in " +
      "front of this app, req.ip is the proxy for every request and per-IP rate " +
      "limits apply to all customers collectively. Verify with GET /healthz.",
  );
}

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), clientIp: req.ip });
});

app.get("/readyz", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch (err) {
    console.error("Readiness check failed — database unreachable:", err);
    res
      .status(503)
      .json({ status: "not ready", error: "database unreachable" });
  }
});

//MIDDLEWARES
app.use(express.json());
app.use(globalLimiter);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (trustedOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());

app.use("/admin", requireTrustedOrigin);

//ROUTES
app.use("/auth", customerAuthRoutes);
app.use("/customers", customerAccountRoutes);
app.use("/admin/auth", adminAuthRoutes);
app.use("/admin/staff", adminStaffRoutes);
app.use("/", productsRoutes);
app.use("/admin/products", adminProductsRoutes);
app.use("/", springTypesRoutes);
app.use("/admin/spring-types", adminSpringTypesRoutes);
app.use("/", checkoutRoutes);
app.use("/admin/orders", adminOrdersRoutes);
app.use("/", quotesRoutes);
app.use("/admin/quotes", adminQuotesRoutes);
app.use("/", contentRoutes);
app.use("/admin/content", adminContentRoutes);
app.use("/", galleryRoutes);
app.use("/admin/gallery", adminGalleryRoutes);
app.use("/", contactRoutes);

app.get("/", (req, res) => {
  res.json({ message: "GSC backend API" });
});

// Anything that matched no route above.
app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

app.use((err: any, req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: "Something went wrong" });
});

const server = app.listen(PORT, () => {
  console.log(`GSC backend listening on port ${PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — finishing in-flight requests…`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out after 10s — exiting now.");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (err) => {
    if (err) {
      console.error("Error while closing the HTTP server:", err);
    }
    try {
      await prisma.$disconnect();
    } catch (dbErr) {
      console.error("Error disconnecting Prisma:", dbErr);
    }
    console.log("Shutdown complete.");
    process.exit(err ? 1 : 0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
