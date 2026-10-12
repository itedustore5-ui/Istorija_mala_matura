import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Непозната путања под /api мора да врати JSON 404.
//
// Без овога је хватао доњи `/{*path}` и враћао `index.html` са статусом 200:
// клијент добије HTML, `response.json()` пукне, а у интерфејсу се појави
// „Дошло је до грешке“ уместо јасног 404. Због тога је и провера здравља у
// `probni-prolaz` дуго „пролазила“ иако је звала непостојећу путању.
app.use("/api", (req, res) => {
  res.status(404).json({ message: `Непозната путања: ${req.method} /api${req.path}` });
});

// Грешка у API рути мора да остане JSON. Подразумевани Express руковалац враћа
// HTML страну, коју клијент не уме да прочита.
app.use("/api", (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err }, "Необрађена грешка у API рути");
  res.status(500).json({ message: "Дошло је до грешке на серверу." });
});

if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(process.cwd(), "artifacts/istorija-kviz/dist/public");
  app.use(express.static(publicDir));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

export default app;
