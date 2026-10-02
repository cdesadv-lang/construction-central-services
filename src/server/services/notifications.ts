import type { Role } from "@prisma/client";
import type { Tx } from "@/lib/db";

export async function usersForRole(tx: Tx, companyId: string, role: Role) {
  return tx.user.findMany({
    where: { role, isActive: true, OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] },
    select: { id: true },
  });
}

export async function notifyUsers(
  tx: Tx,
  userIds: string[],
  n: { companyId?: string | null; type: string; title: string; body?: string; link?: string },
) {
  if (!userIds.length) return;
  await tx.notification.createMany({
    data: [...new Set(userIds)].map((userId) => ({ userId, companyId: n.companyId ?? null, type: n.type, title: n.title, body: n.body, link: n.link })),
  });
}

export async function notifyRole(tx: Tx, companyId: string, role: Role, n: { type: string; title: string; body?: string; link?: string }) {
  const users = await usersForRole(tx, companyId, role);
  await notifyUsers(
    tx,
    users.map((u) => u.id),
    { ...n, companyId },
  );
}
