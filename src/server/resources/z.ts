import { z } from "zod";

const blankToNull = (v: unknown) => (v === "" ? null : v);

/** optional string: undefined stays undefined (PATCH), "" -> null */
export const optStr = z.preprocess(blankToNull, z.string().trim().max(2000).nullable().optional());
export const optId = z.preprocess(blankToNull, z.string().min(1).max(64).nullable().optional());
export const reqStr = z.string().trim().min(1).max(500);
export const reqId = z.string().min(1).max(64);
export const money = z.coerce.number().min(0).max(1e13);
export const optMoney = z.preprocess(blankToNull, z.coerce.number().min(0).max(1e13).nullable().optional()).transform((v) => (v === null ? 0 : v));
export const pct = z.coerce.number().min(0).max(100);
export const reqDate = z.coerce.date();
export const optDate = z.preprocess(blankToNull, z.coerce.date().nullable().optional());
export const optInt = z.preprocess(blankToNull, z.coerce.number().int().min(0).nullable().optional());
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");
export const companyIdField = { companyId: reqId };
export const bool = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
