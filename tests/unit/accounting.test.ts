import { describe, expect, it } from "vitest";
import { checkBalanced, naturalBalance, UnbalancedError } from "@/lib/accounting";

describe("checkBalanced (double-entry rules)", () => {
  it("accepts balanced entries and returns totals", () => {
    const t = checkBalanced([
      { accountId: "a", debit: 1000.5 },
      { accountId: "b", credit: 600.25 },
      { accountId: "c", credit: "400.25" },
    ]);
    expect(t.totalDebit.toFixed(2)).toBe("1000.50");
    expect(t.totalCredit.toFixed(2)).toBe("1000.50");
  });
  it("rejects unbalanced entries", () => {
    expect(() => checkBalanced([{ accountId: "a", debit: 100 }, { accountId: "b", credit: 99.99 }])).toThrow(UnbalancedError);
  });
  it("rejects lines with both debit and credit, zero lines, negatives, single lines", () => {
    expect(() => checkBalanced([{ accountId: "a", debit: 10, credit: 10 }, { accountId: "b" }])).toThrow(/both/);
    expect(() => checkBalanced([{ accountId: "a", debit: 10 }, { accountId: "b", credit: 0 }])).toThrow(/debit or a credit/);
    expect(() => checkBalanced([{ accountId: "a", debit: -10 }, { accountId: "b", credit: -10 }])).toThrow(/negative/);
    expect(() => checkBalanced([{ accountId: "a", debit: 10 }])).toThrow(/two lines/);
  });
  it("is not fooled by floating point", () => {
    expect(() => checkBalanced([{ accountId: "a", debit: 0.1 }, { accountId: "b", debit: 0.2 }, { accountId: "c", credit: 0.3 }])).not.toThrow();
  });
  it("computes natural balances", () => {
    expect(naturalBalance("ASSET", 100, 30).toNumber()).toBe(70);
    expect(naturalBalance("LIABILITY", 100, 30).toNumber()).toBe(-70);
    expect(naturalBalance("REVENUE", 0, 500).toNumber()).toBe(500);
  });
});
