import { route, readJson } from "@/server/api";
import { getDef } from "@/server/resources";
import { actionResource } from "@/server/resources/engine";

type P = { resource: string; id: string; action: string };
export const POST = route<P>(async ({ req, ctx, params }) => actionResource(getDef(params.resource), ctx, params.id, params.action, await readJson(req)), { status: 200 });
