import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { publicRoute, readJson } from "@/server/api";
import { clearLoginFailures, createSession, loginThrottled, recordLoginFailure, SESSION_COOKIE, verifyPassword } from "@/server/auth";
import { requestIp } from "@/server/context";
import { audit } from "@/server/audit";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const POST = publicRoute(async ({ req }) => {
  const { email, password } = schema.parse(await readJson(req));
  const ip = requestIp(req.headers);
  const key = `${email}|${ip}`;
  if (loginThrottled(key)) throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again later.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    recordLoginFailure(key);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  clearLoginFailures(key);
  const { token, expiresAt } = await createSession(user.id, ip, req.headers.get("user-agent"));
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: user.id, ip, action: "LOGIN", entity: "User", entityId: user.id } });
  const res = NextResponse.json({ data: { user: { id: user.id, name: user.name, email: user.email, role: user.role, lang: user.lang }, token, expiresAt } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
  return res;
});

void audit;
