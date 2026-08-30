import "dotenv/config";
import express from "express";
import customerAuthRoutes from "./routes/customerAuth.routes";
import cookieParser from "cookie-parser";
import cors from "cors";
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

//MIDDLEWARES
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());

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

app.listen(PORT, () => {
  console.log(`GSC backend listening on port ${PORT}`);
});
