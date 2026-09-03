import { Router } from "express";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  addProductImages,
  deleteProductImage,
  reorderProductImages,
} from "../controllers/adminProducts.controller";
import { requireAdminAuth } from "../middleware/adminAuth";
import { productImageUpload, handleUpload } from "../lib/upload";

const router = Router();

// Admin AND Staff can manage products — only staff-account/settings
// management is Admin-only.
router.use(requireAdminAuth);

router.post("/", createProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);
router.post(
  "/:id/images",
  handleUpload(productImageUpload.array("images", 10)),
  addProductImages,
);
// Registered before /:imageId so "reorder" isn't captured as an image id.
router.put("/:id/images/reorder", reorderProductImages);
router.delete("/:id/images/:imageId", deleteProductImage);

export default router;
