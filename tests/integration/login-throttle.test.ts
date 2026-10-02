import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clearLoginFailures, loginThrottled, recordLoginFailure, THROTTLE, throttleKeys } from "@/server/auth";
import { POST as login } from "@/app/api/auth/login/route";

const email = "throttle.test@ccs.local";

function loginReq(pw: string, ip: string) {
  return new NextRequest(new URL("http://localhost/api/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email: "acc.nile@ccs.local", password: pw }),
  });
}

describe("persistent login throttling", () => {
  it("locks after N failures and the lock is stored in the database", async () => {
    await prisma.loginThrottle.deleteMany({ where: { key: { contains: email } } });
    for (let i = 0; i < THROTTLE.maxPerAccount - 1; i++) await recordLoginFailure(email, "10.0.0.1");
    expect(await loginThrottled(email, "10.0.0.1")).toBeNull();
    await recordLoginFailure(email, "10.0.0.1");
    const until = await loginThrottled(email, "10.0.0.1");
    expect(until).toBeInstanceOf(Date);
    const row = await prisma.loginThrottle.findUniqueOrThrow({ where: { key: throttleKeys(email, "10.0.0.1").acct } });
    expect(row.failures).toBe(THROTTLE.maxPerAccount);
    // other ip for the same email is not locked yet (email-level threshold is higher)
    expect(await loginThrottled(email, "10.0.0.2")).toBeNull();
    await clearLoginFailures(email, "10.0.0.1");
    expect(await loginThrottled(email, "10.0.0.1")).toBeNull();
  });

  it("email-level lock cannot be bypassed by rotating X-Forwarded-For", async () => {
    await prisma.loginThrottle.deleteMany({ where: { key: { contains: email } } });
    for (let i = 0; i < THROTTLE.maxPerEmail; i++) await recordLoginFailure(email, `10.1.${Math.floor(i / 200)}.${i % 200}`);
    expect(await loginThrottled(email, "10.9.9.9")).toBeInstanceOf(Date);
    await prisma.loginThrottle.deleteMany({ where: { key: { contains: email } } });
  });

  it("login route returns 429 once locked, then succeeds after the lock is cleared", async () => {
    const ip = "10.20.30.40";
    await prisma.loginThrottle.deleteMany({ where: { key: { contains: "acc.nile@ccs.local" } } });
    for (let i = 0; i < THROTTLE.maxPerAccount; i++) expect((await login(loginReq("wrong-password", ip), { params: Promise.resolve({}) } as never)).status).toBe(401);
    expect((await login(loginReq("Demo@12345", ip), { params: Promise.resolve({}) } as never)).status).toBe(429);
    await prisma.loginThrottle.deleteMany({ where: { key: { contains: "acc.nile@ccs.local" } } });
    expect((await login(loginReq("Demo@12345", ip), { params: Promise.resolve({}) } as never)).status).toBe(200);
  });
});
