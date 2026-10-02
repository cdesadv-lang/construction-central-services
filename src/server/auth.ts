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

// Persistent login throttling (table LoginThrottle). Two keys per attempt:
//  - "acct:<email>|<ip>": 10 failures within 15 min locks that email+ip for 15 min
//  - "email:<email>": 30 failures within 15 min locks the email from any ip (spoofed X-Forwarded-For can't bypass it)
//  - "ip:<ip>": 50 failures within 15 min locks the ip (credential-stuffing guard)
export const THROTTLE = {
  windowMs: Number(process.env.LOGIN_WINDOW_MINUTES ?? 15) * 60_000,
  lockMs: Number(process.env.LOGIN_LOCK_MINUTES ?? 15) * 60_000,
  maxPerAccount: Number(process.env.LOGIN_MAX_FAILURES ?? 10),
  maxPerEmail: Number(process.env.LOGIN_MAX_FAILURES_PER_EMAIL ?? 30),
  maxPerIp: Number(process.env.LOGIN_MAX_FAILURES_PER_IP ?? 50),
};

export const throttleKeys = (email: string, ip: string | null) => ({ acct: `acct:${email}|${ip ?? "-"}`, email: `email:${email}`, ip: `ip:${ip ?? "-"}` });

/** Returns the lock expiry if either key is currently locked. */
export async function loginThrottled(email: string, ip: string | null): Promise<Date | null> {
  const k = throttleKeys(email, ip);
  const rows = await prisma.loginThrottle.findMany({ where: { key: { in: [k.acct, k.email, k.ip] }, lockedUntil: { gt: new Date() } } });
  if (!rows.length) return null;
  return rows.reduce((m, r) => (r.lockedUntil! > m ? r.lockedUntil! : m), rows[0].lockedUntil!);
}

async function bump(key: string, max: number) {
  const now = new Date();
  const windowFrom = new Date(now.getTime() - THROTTLE.windowMs);
  const lockUntil = new Date(now.getTime() + THROTTLE.lockMs);
  // Atomic upsert: restart the window if it expired, otherwise increment; lock when the threshold is reached.
  await prisma.$executeRaw`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart", "lockedUntil", "updatedAt")
    VALUES (${key}, 1, ${now}, NULL, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "failures"    = CASE WHEN "LoginThrottle"."windowStart" < ${windowFrom} THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < ${windowFrom} THEN ${now} ELSE "LoginThrottle"."windowStart" END,
      "lockedUntil" = CASE
        WHEN "LoginThrottle"."windowStart" >= ${windowFrom} AND "LoginThrottle"."failures" + 1 >= ${max} THEN ${lockUntil}
        ELSE "LoginThrottle"."lockedUntil" END,
      "updatedAt"   = ${now}`;
}

export async function recordLoginFailure(email: string, ip: string | null) {
  const k = throttleKeys(email, ip);
  await bump(k.acct, THROTTLE.maxPerAccount);
  await bump(k.email, THROTTLE.maxPerEmail);
  await bump(k.ip, THROTTLE.maxPerIp);
}

export async function clearLoginFailures(email: string, ip: string | null) {
  await prisma.loginThrottle.deleteMany({ where: { key: throttleKeys(email, ip).acct } });
  // Opportunistic cleanup of stale rows
  await prisma.loginThrottle.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
}
