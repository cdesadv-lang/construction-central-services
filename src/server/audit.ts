import type { Tx } from "@/lib/db";
import type { Ctx } from "./context";

const clean = (v: unknown) => (v === undefined || v === null ? undefined : JSON.parse(JSON.stringify(v)));

export async function audit(
  tx: Tx,
  ctx: Ctx | null,
  e: { action: string; entity: string; entityId?: string | null; companyId?: string | null; before?: unknown; after?: unknown },
) {
  await tx.auditLog.create({
    data: {
      userId: ctx?.user.id ?? null,
      ip: ctx?.ip ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      companyId: e.companyId ?? null,
      before: clean(e.before),
      after: clean(e.after),
    },
  });
}
