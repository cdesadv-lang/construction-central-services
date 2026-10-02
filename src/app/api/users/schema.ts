import { z } from "zod";
import { ROLES } from "@/lib/permissions";

export const userCreate = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1),
  nameEn: z.string().trim().optional().nullable(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ROLES),
  allCompanies: z.boolean().optional(),
  isActive: z.boolean().optional(),
  companyIds: z.array(z.string()).optional(),
  projectIds: z.array(z.string()).optional(),
});
export const userUpdate = userCreate.partial().extend({ password: z.string().min(8).optional().or(z.literal("")) });

export const userSelect = {
  id: true, email: true, name: true, nameEn: true, role: true, allCompanies: true, isActive: true, lastLoginAt: true, createdAt: true,
  companies: { select: { company: { select: { id: true, code: true, name: true } } } },
  projects: { select: { project: { select: { id: true, code: true, name: true, companyId: true } } } },
} as const;
