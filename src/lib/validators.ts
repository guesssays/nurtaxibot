import { EmployeeRole, RegistrationErrorReason, RegistrationSource } from "@prisma/client";
import { z } from "zod";

export const employeeCreateSchema = z.object({
  telegramId: z
    .union([z.string(), z.number(), z.bigint()])
    .optional()
    .transform((value) => (value === undefined ? undefined : BigInt(value))),
  employeeCode: z.string().trim().min(2).max(64),
  fullName: z.string().trim().min(3).max(255),
  role: z.nativeEnum(EmployeeRole).default(EmployeeRole.EMPLOYEE),
  isActive: z.boolean().default(true),
});

export const employeeUpdateSchema = z.object({
  telegramId: z
    .union([z.string(), z.number(), z.bigint(), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined ? value : BigInt(value))),
  employeeCode: z.string().trim().min(2).max(64).optional(),
  fullName: z.string().trim().min(3).max(255).optional(),
  role: z.nativeEnum(EmployeeRole).optional(),
  isActive: z.boolean().optional(),
});

export const reportRangeQuerySchema = z.object({
  startDate: z.string().trim().min(10),
  endDate: z.string().trim().min(10),
  employeeId: z.string().trim().optional(),
  source: z.nativeEnum(RegistrationSource).optional(),
  includeErrorsOnly: z.coerce.boolean().optional(),
  includeAntifraudOnly: z.coerce.boolean().optional(),
});

export const exportQuerySchema = reportRangeQuerySchema.extend({
  timezone: z.string().trim().optional(),
});

export const broadcastListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export const broadcastGetQuerySchema = z.object({
  broadcastId: z.string().trim().min(1),
});

export const releaseActiveRegistrationSchema = z.object({
  registrationId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(1000),
});

export const registrationStartSchema = z.object({
  phoneInput: z.string().trim().min(1),
  source: z.nativeEnum(RegistrationSource),
});

export const markErrorSchema = z.object({
  reason: z.nativeEnum(RegistrationErrorReason),
  comment: z.string().trim().max(1000).optional(),
});
