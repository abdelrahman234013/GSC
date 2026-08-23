import "dotenv/config";
import express from "express";
import customerAuthRoutes from "./routes/customerAuth.routes";
import cookieParser from "cookie-parser";
import cors from "cors";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

//MIDDLEWARES
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());

//ROUTES
app.use("/auth", customerAuthRoutes);

app.get("/", (req, res) => {
  res.json({ message: "GSC backend API" });
});

app.listen(PORT, () => {
  console.log(`GSC backend listening on port ${PORT}`);
});
