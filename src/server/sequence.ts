import type { Tx } from "@/lib/db";

export async function nextNumber(tx: Tx, companyId: string, key: string, prefix = key, pad = 5) {
  const seq = await tx.sequence.upsert({
    where: { companyId_key: { companyId, key } },
    create: { companyId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(seq.value).padStart(pad, "0")}`;
}
