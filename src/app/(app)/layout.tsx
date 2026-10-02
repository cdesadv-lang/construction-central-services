import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { pageContext } from "@/server/context";
import { AppProvider } from "@/components/app-provider";
import { AppShell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageContext();
  if (!ctx) redirect("/login");
  const lang = (await cookies()).get("lang")?.value === "en" ? "en" : "ar";
  const [companies, unread] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: ctx.companyIds } }, select: { id: true, code: true, name: true, nameEn: true }, orderBy: { code: "asc" } }),
    prisma.notification.count({ where: { userId: ctx.user.id, read: false } }),
  ]);
  return (
    <AppProvider
      user={{ id: ctx.user.id, name: ctx.user.name, nameEn: ctx.user.nameEn, email: ctx.user.email, role: ctx.role, allCompanies: ctx.user.allCompanies }}
      perms={[...ctx.perms]}
      companies={companies}
      projectIds={ctx.projectIds}
      lang={lang}
      unread={unread}
    >
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
