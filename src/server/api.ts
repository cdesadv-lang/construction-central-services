import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError, badRequest } from "@/lib/errors";
import { contextFromRequest, type Ctx } from "./context";

type Params = Record<string, string>;

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Validation failed", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002")
      return NextResponse.json({ error: { code: "DUPLICATE", message: `Duplicate value for ${(err.meta?.target as string[] | undefined)?.join(", ") ?? "unique field"}` } }, { status: 409 });
    if (err.code === "P2025") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Record not found" } }, { status: 404 });
    if (err.code === "P2003")
      return NextResponse.json({ error: { code: "IN_USE", message: "Record is referenced by other records and cannot be removed" } }, { status: 409 });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Internal server error" } }, { status: 500 });
}

function wrap(result: unknown, status = 200) {
  if (result instanceof Response) return result;
  return NextResponse.json({ data: result ?? null }, { status });
}

export function route<P extends Params = Params>(
  handler: (a: { req: NextRequest; ctx: Ctx; params: P }) => Promise<unknown>,
  opts: { status?: number } = {},
) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      const ctx = await contextFromRequest(req);
      const params = (await context?.params) ?? ({} as P);
      return wrap(await handler({ req, ctx, params }), req.method === "POST" ? (opts.status ?? 201) : 200);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function publicRoute<P extends Params = Params>(handler: (a: { req: NextRequest; params: P }) => Promise<unknown>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      const params = (await context?.params) ?? ({} as P);
      return wrap(await handler({ req, params }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T = unknown>(req: NextRequest): Promise<T> {
  try {
    const text = await req.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw badRequest("Invalid JSON body");
  }
}

export function listParams(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(sp.get("pageSize") ?? 25) || 25));
  return {
    sp,
    page,
    pageSize,
    q: sp.get("q")?.trim() || undefined,
    companyId: sp.get("companyId") || undefined,
    projectId: sp.get("projectId") || undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
  };
}

export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]) {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : []);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))];
  return "\uFEFF" + lines.join("\n");
}

export function csvResponse(filename: string, csv: string) {
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` },
  });
}
