/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildContext, type Ctx } from "@/server/context";
import { RESOURCES } from "@/server/resources";
import { actionResource, createResource, getResource, listResource, updateResource, deleteResource } from "@/server/resources/engine";

export async function ctxFor(email: string): Promise<Ctx> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return buildContext(u, "127.0.0.1");
}
export const company = (code: string) => prisma.company.findUniqueOrThrow({ where: { code } });
export const req = (url: string) => new NextRequest(new URL(url, "http://localhost"));
export const list = (ctx: Ctx, res: string, qs = "") => listResource(RESOURCES[res], ctx, req(`/api/${res}?pageSize=500&${qs}`)) as Promise<any>;
export const get = (ctx: Ctx, res: string, id: string) => getResource(RESOURCES[res], ctx, id) as Promise<any>;
export const create = (ctx: Ctx, res: string, body: any) => createResource(RESOURCES[res], ctx, body) as Promise<any>;
export const update = (ctx: Ctx, res: string, id: string, body: any) => updateResource(RESOURCES[res], ctx, id, body) as Promise<any>;
export const remove = (ctx: Ctx, res: string, id: string) => deleteResource(RESOURCES[res], ctx, id) as Promise<any>;
export const act = (ctx: Ctx, res: string, id: string, action: string, body: any = {}) => actionResource(RESOURCES[res], ctx, id, action, body) as Promise<any>;

export async function expectApiError(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e: any) {
    if (e?.status !== status) throw new Error(`Expected status ${status}, got ${e?.status}: ${e?.message}`);
    return e;
  }
  throw new Error(`Expected ApiError ${status} but call succeeded`);
}
