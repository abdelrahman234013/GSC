import { Router } from "express";
import {
  listProducts,
  getProductBySlug,
  getProductCategories,
} from "../controllers/products.controller";

const router = Router();

router.get("/products", listProducts);
router.get("/products/:slug", getProductBySlug);
router.get("/product-categories", getProductCategories);

export default router;
