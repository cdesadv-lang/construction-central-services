import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import type { Role, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { forbidden, unauthorized } from "@/lib/errors";
import { permKey, type ActionKey, type ModuleKey } from "@/lib/permissions";
import { SESSION_COOKIE, getSessionUser } from "./auth";

export interface Ctx {
  user: Pick<User, "id" | "name" | "nameEn" | "email" | "role" | "allCompanies" | "lang">;
  role: Role;
  perms: Set<string>;
  companyIds: string[];
  /** null => unrestricted within permitted companies */
  projectIds: string[] | null;
  ip: string | null;
}

export async function buildContext(user: User, ip: string | null): Promise<Ctx> {
  const [perms, companies, projects] = await Promise.all([
    prisma.rolePermission.findMany({ where: { role: user.role }, select: { module: true, action: true } }),
    user.allCompanies
      ? prisma.company.findMany({ select: { id: true } })
      : prisma.userCompany.findMany({ where: { userId: user.id }, select: { companyId: true } }),
    prisma.userProject.findMany({ where: { userId: user.id }, select: { projectId: true } }),
  ]);
  const companyIds = companies.map((c) => ("id" in c ? c.id : c.companyId));
  return {
    user: { id: user.id, name: user.name, nameEn: user.nameEn, email: user.email, role: user.role, allCompanies: user.allCompanies, lang: user.lang },
    role: user.role,
    perms: new Set(perms.map((p) => permKey(p.module, p.action))),
    companyIds,
    projectIds: projects.length ? projects.map((p) => p.projectId) : null,
    ip,
  };
}

function tokenFromRequest(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.cookies.get(SESSION_COOKIE)?.value;
}

export function requestIp(h: Headers) {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function contextFromRequest(req: NextRequest): Promise<Ctx> {
  const user = await getSessionUser(tokenFromRequest(req));
  if (!user) throw unauthorized();
  return buildContext(user, requestIp(req.headers));
}

/** For server components / layouts. Returns null when not logged in. */
export async function pageContext(): Promise<Ctx | null> {
  const c = await cookies();
  const user = await getSessionUser(c.get(SESSION_COOKIE)?.value);
  if (!user) return null;
  return buildContext(user, requestIp(await headers()));
}

export const can = (ctx: Ctx, module: ModuleKey, action: ActionKey) => ctx.perms.has(permKey(module, action));

export function requirePerm(ctx: Ctx, module: ModuleKey, action: ActionKey) {
  if (!can(ctx, module, action)) throw forbidden(`Missing permission ${module}:${action}`);
}

export function hasCompany(ctx: Ctx, companyId: string | null | undefined) {
  return !!companyId && ctx.companyIds.includes(companyId);
}

export function assertCompany(ctx: Ctx, companyId: string | null | undefined) {
  if (!hasCompany(ctx, companyId)) throw forbidden("No access to this company");
}

/** Company ids to filter a query by; validates a requested company. */
export function companyScope(ctx: Ctx, requested?: string | null): string[] {
  if (requested) {
    assertCompany(ctx, requested);
    return [requested];
  }
  return ctx.companyIds;
}

export function hasProject(ctx: Ctx, projectId: string | null | undefined) {
  if (ctx.projectIds === null) return true;
  return !!projectId && ctx.projectIds.includes(projectId);
}

export function assertProject(ctx: Ctx, projectId: string | null | undefined) {
  if (!hasProject(ctx, projectId)) throw forbidden("No access to this project");
}
