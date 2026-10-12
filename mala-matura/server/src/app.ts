import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Db } from "./db/client.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { studentRoutes } from "./routes/student.js";

/**
 * Express апликација над датом базом. Одвојена од `index.ts` да би тестови
 * могли да је подигну над базом у меморији.
 *
 * `clientDir` — изграђени клијент (`client/dist`); кад постоји, сервер га
 * служи на истој адреси, па у продукцији нема посебног статичког сајта.
 */
export function createApp(db: Db, options: { clientDir?: string } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", authRoutes(db));
  app.use("/api", studentRoutes(db));
  app.use("/api", adminRoutes(db));

  // Непозната путања под /api враћа JSON 404, а не почетну страну клијента:
  // иначе би `response.json()` у клијенту пукао на HTML-у.
  app.use("/api", (req, res) => {
    res.status(404).json({ message: `Непозната путања: ${req.method} /api${req.path}` });
  });

  // Грешка у рути остаје JSON; подразумевани Express руковалац враћа HTML.
  app.use("/api", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const parse = (err as { type?: string })?.type === "entity.parse.failed";
    if (!parse) console.error("Грешка у API рути:", err);
    res.status(parse ? 400 : 500).json({ message: parse ? "Неисправан захтев." : "Дошло је до грешке на серверу." });
  });

  const clientDir = options.clientDir;
  if (clientDir && fs.existsSync(path.join(clientDir, "index.html"))) {
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  return app;
}
