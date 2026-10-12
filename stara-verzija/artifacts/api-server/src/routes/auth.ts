import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, users, type User } from "@workspace/db";
import { createToken, requireAuth, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const publicUser = (user: User) => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role as "admin" | "student",
  active: user.active,
  neverExpires: user.neverExpires,
  quizOnce: user.quizOnce,
});

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body as { username: string; password: string };
    if (!username || !password) {
      res.status(400).json({ message: "Потребно је корисничко име и лозинка." });
      return;
    }
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user || !user.active) {
      res.status(401).json({ message: "Погрешно корисничко име или лозинка." });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ message: "Погрешно корисничко име или лозинка." });
      return;
    }
    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ message: "Грешка при пријави." });
  }
});

router.get("/auth/me", requireAuth, (req, res) => {
  const user = (req as AuthedRequest).user;
  res.json(publicUser(user));
});

export default router;
