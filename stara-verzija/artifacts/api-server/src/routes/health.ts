import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Проверу користи хостинг да види да ли је инстанца жива. Одговор је намерно
// обичан објекат: раније је пролазио кроз генерисану Zod шему, због које су у
// workspace-у стајала три пакета зарад једног поља.
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
