import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSession } from "@/server/auth";
import { LocalDiskStorage, S3Storage, activeDriverName, driverFor, silenceSdkNodeWarning, storagePolicyProblem } from "@/server/storage";
import { NextRequest } from "next/server";
import { POST as upload } from "@/app/api/documents/route";
import { GET as download, DELETE as del } from "@/app/api/documents/[id]/route";

// S3 tests run against any S3-compatible endpoint given in S3_TEST_ENDPOINT (e.g. `docker run -p 9090:9090 -e initialBuckets=ccs-docs adobe/s3mock`).
const S3_ENDPOINT = process.env.S3_TEST_ENDPOINT;
const S3_BUCKET = process.env.S3_TEST_BUCKET ?? "ccs-docs";

describe("local disk driver", () => {
  it("put/get/remove and rejects path traversal", async () => {
    const s = new LocalDiskStorage("./storage/test-uploads");
    await s.put("t/a.txt", Buffer.from("abc"));
    expect((await s.get("t/a.txt")).toString()).toBe("abc");
    await s.remove("t/a.txt");
    await expect(s.get("t/a.txt")).rejects.toThrow();
    await expect(s.put("../../etc/x", Buffer.from("x"))).rejects.toThrow("Invalid storage key");
  });
});

describe("storage selection from the environment", () => {
  it("STORAGE_DRIVER wins; otherwise s3 when S3_BUCKET is set; local by default", () => {
    expect(activeDriverName({})).toBe("local");
    expect(activeDriverName({ S3_BUCKET: "b" })).toBe("s3");
    expect(activeDriverName({ S3_BUCKET: "b", STORAGE_DRIVER: "local" })).toBe("local");
    expect(activeDriverName({ STORAGE_DRIVER: "S3" })).toBe("s3");
  });
  it("refuses local uploads on an ephemeral filesystem (Vercel) unless explicitly allowed", () => {
    expect(storagePolicyProblem({ VERCEL: "1" })).toMatch(/persistent storage/);
    expect(storagePolicyProblem({ VERCEL: "1", S3_BUCKET: "b" })).toBeNull();
    expect(storagePolicyProblem({ VERCEL: "1", ALLOW_EPHEMERAL_UPLOADS: "true" })).toBeNull();
    expect(storagePolicyProblem({ EPHEMERAL_FS: "true" })).toMatch(/persistent storage/);
    expect(storagePolicyProblem({})).toBeNull();
  });
  it("silences the AWS SDK Node-version notice only on Node < 22 and never overrides an explicit setting", () => {
    const a: Record<string, string | undefined> = {};
    silenceSdkNodeWarning("v20.19.2", a);
    expect(a.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED).toBe("true");
    const b: Record<string, string | undefined> = {};
    silenceSdkNodeWarning("v22.11.0", b);
    expect(b.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED).toBeUndefined();
    const c: Record<string, string | undefined> = { AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED: "false" };
    silenceSdkNodeWarning("v20.19.2", c);
    expect(c.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED).toBe("false");
  });
});

describe.skipIf(!S3_ENDPOINT)("S3-compatible driver", () => {
  const prev = { ...process.env };
  afterAll(() => {
    process.env = prev;
  });

  it("put/get/remove against a real S3 endpoint", async () => {
    const s = new S3Storage({ bucket: S3_BUCKET, endpoint: S3_ENDPOINT, accessKeyId: "test", secretAccessKey: "test", prefix: "unit" });
    await s.check();
    await s.put("x/hello.txt", Buffer.from("مرحبا S3"), "text/plain");
    expect((await s.get("x/hello.txt")).toString()).toBe("مرحبا S3");
    await s.remove("x/hello.txt");
    await expect(s.get("x/hello.txt")).rejects.toThrow();
  });

  it("documents API stores in S3 when STORAGE_DRIVER=s3 and keeps the driver per document", async () => {
    Object.assign(process.env, { STORAGE_DRIVER: "s3", S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test", S3_PREFIX: "api" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "acc.nile@ccs.local" } });
    const company = await prisma.company.findUniqueOrThrow({ where: { code: "NILE" } });
    const { token } = await createSession(user.id);
    const cookie = `ccs_session=${token}`;
    const fd = new FormData();
    fd.set("companyId", company.id);
    fd.set("file", new Blob(["s3 body"], { type: "text/plain" }), "s3.txt");
    const res = await upload(new NextRequest("http://localhost/api/documents", { method: "POST", body: fd, headers: { cookie } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    const doc = (await res.json()).data;
    expect(doc.storageDriver).toBe("s3");
    expect((await driverFor("s3").get(doc.storageKey)).toString()).toBe("s3 body");
    const dl = await download(new NextRequest(`http://localhost/api/documents/${doc.id}`, { headers: { cookie } }), { params: Promise.resolve({ id: doc.id }) });
    expect(await dl.text()).toBe("s3 body");
    // switching back to local still serves the S3 document
    process.env.STORAGE_DRIVER = "local";
    const dl2 = await download(new NextRequest(`http://localhost/api/documents/${doc.id}`, { headers: { cookie } }), { params: Promise.resolve({ id: doc.id }) });
    expect(dl2.status).toBe(200);
    const cfo = await prisma.user.findUniqueOrThrow({ where: { email: "cfo@ccs.local" } });
    const t2 = (await createSession(cfo.id)).token;
    const d = await del(new NextRequest(`http://localhost/api/documents/${doc.id}`, { method: "DELETE", headers: { cookie: `ccs_session=${t2}` } }), { params: Promise.resolve({ id: doc.id }) });
    expect(d.status).toBe(200);
    await expect(driverFor("s3").get(doc.storageKey)).rejects.toThrow();
  });
});
