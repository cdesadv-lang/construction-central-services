import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, num } from "@/lib/money";
import { companyScope, type Ctx } from "../context";
import { projectActuals } from "./reports";

export async function dashboard(ctx: Ctx, companyId?: string) {
  const companyIds = companyScope(ctx, companyId);
  const pf = ctx.projectIds ? { projectId: { in: ctx.projectIds } } : {};
  const projWhere = { companyId: { in: companyIds }, ...(ctx.projectIds ? { id: { in: ctx.projectIds } } : {}) };
  const today = new Date();
  const [companies, projects, clientEx, contractorEx, invoices, payments, plRows, cashParents] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, code: true } }),
    prisma.project.findMany({ where: projWhere, select: { id: true, code: true, name: true, status: true, contractValue: true, budget: true, endDate: true, completionPct: true, companyId: true } }),
    prisma.clientExtract.aggregate({ where: { companyId: { in: companyIds }, status: "POSTED", ...pf }, _sum: { workValue: true, netAmount: true, paidAmount: true } }),
    prisma.contractorExtract.aggregate({ where: { companyId: { in: companyIds }, status: "POSTED", ...pf }, _sum: { currentGross: true, netAmount: true, paidAmount: true, retentionAmount: true } }),
    prisma.supplierInvoice.aggregate({ where: { companyId: { in: companyIds }, status: "POSTED", ...pf }, _sum: { total: true, paidAmount: true } }),
    prisma.payment.groupBy({ by: ["type"], where: { companyId: { in: companyIds }, status: "POSTED", ...pf }, _sum: { amount: true } }),
    prisma.$queryRaw<{ m: string; type: string; d: Prisma.Decimal; c: Prisma.Decimal }[]>`
      SELECT to_char(e."date", 'YYYY-MM') AS m, a."type"::text AS type, SUM(l."debit") AS d, SUM(l."credit") AS c
      FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId" JOIN "Account" a ON a."id" = l."accountId"
      WHERE e."status" = 'POSTED' AND l."companyId" = ANY(${companyIds}) AND a."type" IN ('REVENUE','EXPENSE')
        AND COALESCE(e."sourceType", '') NOT IN ('YEAR_END_CLOSE', 'YEAR_END_CLOSE_REVERSAL')
      ${ctx.projectIds ? Prisma.sql`AND l."projectId" = ANY(${ctx.projectIds})` : Prisma.empty}
      GROUP BY 1, 2 ORDER BY 1`,
    prisma.account.findMany({ where: { companyId: { in: companyIds }, systemKey: { in: ["CASH_PARENT", "BANK_PARENT"] } }, select: { id: true, systemKey: true } }),
  ]);
  const moneyAccs = await prisma.account.findMany({ where: { parentId: { in: cashParents.map((c) => c.id) } }, select: { id: true, parentId: true } });
  const moneySums = await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: moneyAccs.map((a) => a.id) }, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  const cashParentIds = new Set(cashParents.filter((c) => c.systemKey === "CASH_PARENT").map((c) => c.id));
  let cash = D(0), bank = D(0);
  for (const s of moneySums) {
    const acc = moneyAccs.find((a) => a.id === s.accountId)!;
    const v = D(s._sum.debit).minus(D(s._sum.credit));
    if (cashParentIds.has(acc.parentId!)) cash = cash.plus(v);
    else bank = bank.plus(v);
  }
  let revenue = D(0), expenses = D(0);
  const monthly = new Map<string, { month: string; revenue: number; expenses: number }>();
  for (const r of plRows) {
    const o = monthly.get(r.m) ?? { month: r.m, revenue: 0, expenses: 0 };
    if (r.type === "REVENUE") {
      const v = D(r.c).minus(D(r.d));
      revenue = revenue.plus(v);
      o.revenue += Number(v);
    } else {
      const v = D(r.d).minus(D(r.c));
      expenses = expenses.plus(v);
      o.expenses += Number(v);
    }
    monthly.set(r.m, o);
  }
  const acts = await projectActuals(projects.map((p) => p.id));
  const delayed = projects.filter((p) => p.endDate && p.endDate < today && ["ACTIVE", "SUSPENDED"].includes(p.status) && Number(p.completionPct) < 100);
  const statusCounts = ["PLANNING", "ACTIVE", "SUSPENDED", "COMPLETED", "CLOSED"].map((s) => ({ status: s, count: projects.filter((p) => p.status === s).length }));
  const projectBars = projects
    .map((p) => ({ code: p.code, name: p.name, budget: num(p.budget), actual: num(acts.get(p.id)?.cost ?? 0), revenue: num(acts.get(p.id)?.revenue ?? 0) }))
    .sort((a, b) => b.budget - a.budget)
    .slice(0, 10);
  const cats: Record<string, number> = {};
  for (const a of acts.values()) for (const [k, v] of Object.entries(a.byCat)) cats[k] = (cats[k] ?? 0) + Number(v);
  const byCompany = companies.map((c) => {
    const ps = projects.filter((p) => p.companyId === c.id);
    let rev = 0, cost = 0;
    for (const p of ps) {
      rev += Number(acts.get(p.id)?.revenue ?? 0);
      cost += Number(acts.get(p.id)?.cost ?? 0);
    }
    return { company: c.name, projects: ps.length, contractValue: ps.reduce((s, p) => s + Number(p.contractValue), 0), revenue: Math.round(rev), cost: Math.round(cost), profit: Math.round(rev - cost) };
  });
  const payType = (t: string) => D(payments.find((p) => p.type === t)?._sum.amount);
  const pendingApprovals = await prisma.approvalRequest.findMany({ where: { companyId: { in: companyIds }, status: "PENDING" }, select: { steps: true, currentStep: true, submittedBy: true } });
  const myPending = pendingApprovals.filter((r) => {
    const s = r.steps as { role: string }[];
    return (ctx.role === "SUPER_ADMIN" || s[r.currentStep - 1]?.role === ctx.role) && r.submittedBy !== ctx.user.id;
  }).length;
  return {
    kpis: {
      companies: companies.length,
      projects: projects.length,
      activeProjects: projects.filter((p) => p.status === "ACTIVE").length,
      totalContractValue: num(projects.reduce((s, p) => s.plus(D(p.contractValue)), D(0))),
      totalClientExtracts: num(clientEx._sum.workValue),
      totalContractorExtracts: num(contractorEx._sum.currentGross),
      totalPayments: num(payType("SUPPLIER_PAYMENT").plus(payType("CONTRACTOR_PAYMENT")).plus(payType("CONTRACTOR_ADVANCE"))),
      totalCollections: num(payType("CLIENT_RECEIPT")),
      totalReceivables: num(D(clientEx._sum.netAmount).minus(D(clientEx._sum.paidAmount))),
      totalRevenue: num(revenue),
      totalExpenses: num(expenses),
      profit: num(revenue.minus(expenses)),
      delayedProjects: delayed.length,
      contractorsOwed: num(D(contractorEx._sum.netAmount).minus(D(contractorEx._sum.paidAmount))),
      contractorRetention: num(contractorEx._sum.retentionAmount),
      suppliersOwed: num(D(invoices._sum.total).minus(D(invoices._sum.paidAmount))),
      cashOnHand: num(cash),
      cashAtBank: num(bank),
      myPendingApprovals: myPending,
    },
    charts: {
      monthly: [...monthly.values()].slice(-12).map((m) => ({ ...m, revenue: Math.round(m.revenue), expenses: Math.round(m.expenses), profit: Math.round(m.revenue - m.expenses) })),
      projectStatus: statusCounts,
      projectBars,
      costByCategory: Object.entries(cats).map(([category, amount]) => ({ category, amount: Math.round(amount) })).filter((x) => x.amount > 0),
      byCompany,
    },
    delayed: delayed.map((p) => ({ id: p.id, code: p.code, name: p.name, endDate: p.endDate, completionPct: Number(p.completionPct) })),
  };
}
