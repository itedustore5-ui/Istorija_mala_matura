import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import quizRouter from "./quiz";
import examsRouter from "./exams";
import adminRouter from "./admin";
import researchRouter from "./research";
import exportRouter from "./export";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(quizRouter);
router.use(examsRouter);
router.use(adminRouter);
router.use(researchRouter);
router.use(exportRouter);

export default router;
