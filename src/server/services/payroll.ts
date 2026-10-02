import type { Tx } from "@/lib/db";
import { D, r2, sum } from "@/lib/money";
import { calcPayrollLine } from "@/lib/extracts";
import { unprocessable } from "@/lib/errors";

export async function buildPayrollLines(tx: Tx, companyId: string, month: string, projectId?: string | null, excludePayrollId?: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  const already = await tx.payrollLine.findMany({
    where: { payroll: { companyId, month, status: { not: "CANCELLED" }, ...(excludePayrollId ? { id: { not: excludePayrollId } } : {}) } },
    select: { employeeId: true },
  });
  const done = new Set(already.map((a) => a.employeeId));
  const employees = await tx.employee.findMany({
    where: { companyId, status: { in: ["ACTIVE", "ON_LEAVE"] }, ...(projectId ? { projectId } : {}) },
    include: { allocations: true, adjustments: { where: { month } }, attendance: { where: { date: { gte: from, lte: to } } } },
    orderBy: { code: "asc" },
  });
  const lines = [];
  for (const e of employees) {
    if (done.has(e.id)) continue;
    const adj = (t: string) => sum(e.adjustments.filter((a) => a.type === t).map((a) => a.amount));
    const hourly = D(e.basicSalary).div(240);
    const otHours = sum(e.attendance.map((a) => a.overtimeHours));
    const absentDays = e.attendance.filter((a) => a.status === "ABSENT").length;
    const overtime = r2(adj("OVERTIME").plus(otHours.mul(hourly).mul(1.5)));
    const deductions = r2(adj("DEDUCTION").plus(D(e.basicSalary).div(30).mul(absentDays)));
    const c = calcPayrollLine({
      basic: e.basicSalary,
      allowances: e.allowances,
      overtime,
      bonuses: adj("BONUS"),
      deductions,
      insuranceSalary: e.insuranceSalary,
    });
    const allocations = e.allocations.length
      ? e.allocations.map((a) => ({ projectId: a.projectId, percent: Number(a.percent) }))
      : [{ projectId: e.projectId ?? null, percent: 100 }];
    lines.push({
      employeeId: e.id,
      employeeName: e.name,
      basic: r2(e.basicSalary),
      allowances: r2(e.allowances),
      overtime,
      bonuses: r2(adj("BONUS")),
      deductions: c.deductions,
      insurance: c.insurance,
      companyInsurance: c.companyInsurance,
      tax: c.tax,
      gross: c.gross,
      net: c.net,
      allocations,
    });
  }
  if (!lines.length) throw unprocessable("No eligible employees for this payroll (none found or already included in another payroll this month)");
  const totalGross = sum(lines.map((l) => l.gross));
  const totalNet = sum(lines.map((l) => l.net));
  return { lines, totalGross, totalNet, totalDeductions: totalGross.minus(totalNet) };
}
