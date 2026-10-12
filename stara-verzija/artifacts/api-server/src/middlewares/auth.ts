import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, users, type User } from "@workspace/db";

const secret = process.env.SESSION_SECRET;

if (!secret) {
  throw new Error("SESSION_SECRET must be set");
}

type JwtPayload = {
  sub: number;
  username: string;
  role: string;
  exp: number;
};

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

const sign = (data: string) =>
  crypto.createHmac("sha256", secret).update(data).digest("base64url");

export const createToken = (user: User) => {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: user.id,
      username: user.username,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    }),
  );
  const signature = sign(`${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
};

const verifyToken = (token: string): JwtPayload | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;
  const expected = sign(`${header}.${payload}`);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload;
  if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed;
};

export type AuthedRequest = Request & { user: User };

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ message: "Потребна је пријава." });
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ message: "Сесија није важећа." });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user || !user.active) {
      res.status(401).json({ message: "Корисник није активан." });
      return;
    }

    (req as AuthedRequest).user = user;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Auth middleware failed");
    res.status(401).json({ message: "Сесија није важећа." });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthedRequest).user;
  if (user.role !== "admin") {
    res.status(403).json({ message: "Потребна су admin права." });
    return;
  }
  next();
}
