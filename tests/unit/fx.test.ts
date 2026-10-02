import { describe, expect, it } from "vitest";
import { convertLines, fxBalance, normCurrency, toBase, FxError } from "@/lib/fx";

describe("fx helpers", () => {
  it("normalises currency codes", () => {
    expect(normCurrency(undefined)).toBe("EGP");
    expect(normCurrency(" usd ")).toBe("USD");
    expect(() => normCurrency("US")).toThrow(FxError);
  });
  it("converts amounts to base", () => {
    expect(toBase(100, 48.4433).toNumber()).toBe(4844.33);
  });
  it("EGP lines are untouched", () => {
    const l = [{ accountId: "a", debit: 10 }, { accountId: "b", credit: 10 }];
    expect(convertLines(l, "EGP", 1)).toBe(l);
  });
  it("converted entries stay balanced (rounding absorbed by the largest line)", () => {
    // 3 x 0.335 USD at 48.5 = 16.2475 each -> 16.25 x3 = 48.75 vs total 1.005 * 48.5 = 48.7425 -> 48.74
    const lines = [
      { accountId: "exp1", debit: 0.335 },
      { accountId: "exp2", debit: 0.335 },
      { accountId: "exp3", debit: 0.335 },
      { accountId: "ap", credit: 1.005 },
    ];
    const out = convertLines(lines, "USD", 48.5);
    const dr = out.reduce((s, l) => s + Number(l.debit), 0);
    const cr = out.reduce((s, l) => s + Number(l.credit), 0);
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
    expect(out.every((l) => l.currency === "USD")).toBe(true);
    expect(Number(out[3].fxAmount)).toBe(1.01); // stored at 2 decimals
  });
  it("rejects non-positive rates", () => {
    expect(() => convertLines([{ accountId: "a", debit: 1 }, { accountId: "b", credit: 1 }], "USD", 0)).toThrow(FxError);
  });
  it("computes the foreign-currency balance", () => {
    const b = fxBalance(
      [
        { debit: 4844, credit: 0, fxAmount: 100, currency: "USD" },
        { debit: 0, credit: 1000, fxAmount: 20, currency: "USD" },
        { debit: 0, credit: 5, fxAmount: null, currency: null },
      ],
      "USD",
    );
    expect(b.toNumber()).toBe(80);
  });
});
