import { Router } from "express";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  addProductImages,
} from "../controllers/adminProducts.controller";
import { requireAdminAuth } from "../middleware/adminAuth";
import { productImageUpload } from "../lib/upload";

const router = Router();

// Admin AND Staff can manage products — only staff-account/settings
// management is Admin-only.
router.use(requireAdminAuth);

router.post("/", createProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);
router.post(
  "/:id/images",
  (req, res, next) => {
    productImageUpload.array("images", 10)(req, res, (err) => {
      if (err) {
        return res
          .status(400)
          .json({ error: err.message || "File upload failed" });
      }
      next();
    });
  },
  addProductImages,
);

export default router;
