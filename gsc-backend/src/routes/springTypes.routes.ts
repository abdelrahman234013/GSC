import { Router } from "express";
import { listSpringTypes } from "../controllers/springTypes.controller";

const router = Router();

router.get("/spring-types", listSpringTypes);

export default router;
