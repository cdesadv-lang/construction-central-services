import { Prisma } from "@prisma/client";

export const Dec = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export function D(v: unknown): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v;
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(v as string | number);
}

export function r2(v: Prisma.Decimal | number | string): Prisma.Decimal {
  return D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function num(v: unknown): number {
  return Number(D(v).toFixed(2));
}

export function sum(values: unknown[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(D(v)), new Prisma.Decimal(0));
}
