import { route, readJson } from "@/server/api";
import { getDef } from "@/server/resources";
import { deleteResource, getResource, updateResource } from "@/server/resources/engine";

type P = { resource: string; id: string };
export const GET = route<P>(async ({ ctx, params }) => getResource(getDef(params.resource), ctx, params.id));
export const PATCH = route<P>(async ({ req, ctx, params }) => updateResource(getDef(params.resource), ctx, params.id, await readJson(req)));
export const PUT = PATCH;
export const DELETE = route<P>(async ({ ctx, params }) => deleteResource(getDef(params.resource), ctx, params.id));
