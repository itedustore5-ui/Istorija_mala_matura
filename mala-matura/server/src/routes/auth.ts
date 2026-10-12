import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import { checkPassword, createToken, currentUser, publicUser, requireAuth } from "../auth.js";

export function authRoutes(db: Db): Router {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
      res.status(400).json({ message: "Упиши корисничко име и лозинку." });
      return;
    }
    const [user] = await db.select().from(users).where(eq(users.username, username.trim())).limit(1);
    // Иста порука и кад налог не постоји и кад лозинка не одговара — да се
    // пробањем не може открити која корисничка имена постоје.
    if (!user || !user.active || !(await checkPassword(password, user.passwordHash))) {
      res.status(401).json({ message: "Погрешно корисничко име или лозинка." });
      return;
    }
    res.json({ token: createToken(user), user: publicUser(user) });
  });

  router.get("/auth/me", requireAuth(db), (req, res) => {
    res.json(publicUser(currentUser(req)));
  });

  return router;
}
