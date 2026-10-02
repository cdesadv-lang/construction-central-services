import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "ccs_session";
export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, ip?: string | null, userAgent?: string | null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, ip: ip ?? null, userAgent: userAgent?.slice(0, 250) ?? null },
  });
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined | null) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date() || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// Simple in-memory login throttling (per process): 10 failures / 15 min per email+ip.
const failures = new Map<string, { count: number; until: number }>();
export function loginThrottled(key: string) {
  const f = failures.get(key);
  return !!f && f.count >= 10 && f.until > Date.now();
}
export function recordLoginFailure(key: string) {
  const f = failures.get(key);
  const until = Date.now() + 15 * 60 * 1000;
  if (!f || f.until < Date.now()) failures.set(key, { count: 1, until });
  else failures.set(key, { count: f.count + 1, until });
}
export function clearLoginFailures(key: string) {
  failures.delete(key);
}
