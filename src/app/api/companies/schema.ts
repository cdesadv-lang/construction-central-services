import { z } from "zod";
import { optDate, optStr, reqStr } from "@/server/resources/z";

export const companySchema = z.object({
  code: reqStr,
  name: reqStr,
  nameEn: optStr,
  commercialRegister: optStr,
  taxNumber: optStr,
  address: optStr,
  phone: optStr,
  email: optStr,
  contactPerson: optStr,
  contractStart: optDate,
  contractEnd: optDate,
  servicePackage: z.enum(["BASIC", "STANDARD", "PREMIUM"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]).optional(),
});
