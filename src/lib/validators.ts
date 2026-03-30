import {
  EmployeeRole,
  RegistrationErrorReason,
  RegistrationSource,
  UserRegistrationRequestStatus,
} from "@prisma/client";
import { z } from "zod";

import { normalizeUzPhone } from "./phone";

const telegramIdSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((value) => BigInt(value))
  .refine((value) => value > BigInt(0), "Telegram ID must be positive.");

export const employeeCreateSchema = z.object({
  telegramId: telegramIdSchema.optional(),
  employeeCode: z.string().trim().min(2).max(64),
  fullName: z.string().trim().min(3).max(255),
  phoneE164: z.string().trim().min(1).max(32).transform(normalizeUzPhone).optional().nullable(),
  role: z.nativeEnum(EmployeeRole).default(EmployeeRole.EMPLOYEE),
  isActive: z.boolean().default(true),
});

export const employeeUpdateSchema = z.object({
  telegramId: telegramIdSchema.nullable().optional(),
  employeeCode: z.string().trim().min(2).max(64).optional(),
  fullName: z.string().trim().min(3).max(255).optional(),
  phoneE164: z.string().trim().min(1).max(32).transform(normalizeUzPhone).nullable().optional(),
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

export const telegramIdInputSchema = telegramIdSchema;

export const registrationRequestCreateSchema = z.object({
  telegramId: telegramIdSchema,
  username: z.string().trim().max(255).optional().nullable(),
  firstName: z.string().trim().max(255).optional().nullable(),
  lastName: z.string().trim().max(255).optional().nullable(),
  fullName: z.string().trim().min(3).max(255),
  phone: z.string().trim().min(5).max(64).optional().nullable(),
  requestedRole: z.nativeEnum(EmployeeRole).optional().nullable(),
  employeeCode: z.string().trim().min(2).max(64).optional().nullable(),
  comment: z.string().trim().max(1000).optional().nullable(),
});

export const registrationRequestApprovalSchema = z.object({
  role: z.nativeEnum(EmployeeRole),
  employeeCode: z.string().trim().min(2).max(64),
  fullName: z.string().trim().min(3).max(255),
  isActive: z.boolean().default(true),
  reviewComment: z.string().trim().max(1000).optional().nullable(),
});

export const registrationRequestRejectSchema = z.object({
  reviewComment: z.string().trim().max(1000).optional().nullable(),
});

export const registrationRequestListQuerySchema = z.object({
  status: z.nativeEnum(UserRegistrationRequestStatus).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
