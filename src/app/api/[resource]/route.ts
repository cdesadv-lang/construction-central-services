import { route, readJson } from "@/server/api";
import { getDef } from "@/server/resources";
import { createResource, listResource } from "@/server/resources/engine";

export const GET = route<{ resource: string }>(async ({ req, ctx, params }) => listResource(getDef(params.resource), ctx, req));
export const POST = route<{ resource: string }>(async ({ req, ctx, params }) => createResource(getDef(params.resource), ctx, await readJson(req)));
