import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import type { Db } from "./db/client.js";
import { users, type User } from "./db/schema.js";

/**
 * Пријава токеном потписаним HMAC-SHA256 (облик JWT-а, без библиотеке).
 *
 * Тајна је `SESSION_SECRET`. Ако је нема (локални рад), прави се насумична за
 * овај процес — пријава тада траје до поновног покретања сервера. У продукцији
 * тајна мора бити постављена, иначе сервер одбија да крене.
 */

const TOKEN_HOURS = 12;

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET мора бити постављен у продукцији.");
  }
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString("base64url");
  return process.env.SESSION_SECRET;
}

const b64 = (input: string) => Buffer.from(input).toString("base64url");
const sign = (data: string) =>
  crypto.createHmac("sha256", sessionSecret()).update(data).digest("base64url");

type Payload = { sub: number; role: string; exp: number };

export function createToken(user: Pick<User, "id" | "role">): string {
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(
    JSON.stringify({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600 }),
  );
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

function verifyToken(token: string): Payload | null {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Payload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export type AuthedRequest = Request & { user: User };

export const currentUser = (req: Request) => (req as AuthedRequest).user;

export function requireAuth(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      res.status(401).json({ message: "Потребна је пријава." });
      return;
    }
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user || !user.active) {
      res.status(401).json({ message: "Налог није активан." });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (currentUser(req).role !== "admin") {
    res.status(403).json({ message: "Потребна су администраторска права." });
    return;
  }
  next();
}

export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  role: u.role as "admin" | "student",
  studyArm: u.studyArm,
});
