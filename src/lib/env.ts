import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_WEBHOOK_BASE_URL: z.url(),
  ADMIN_API_KEY: z.string().min(1),
  APP_TIMEZONE: z.string().default("Asia/Tashkent"),
  APP_LOCALE: z.string().default("ru"),
  ANTIFRAUD_FAST_REGISTRATION_SECONDS: z.coerce.number().int().positive().default(120),
  REMINDER_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(15),
  REMINDER_REPEAT_MINUTES: z.coerce.number().int().positive().default(30),
  DEFAULT_EXPORT_TIMEZONE: z.string().default("Asia/Tashkent"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SEED_ADMIN_FULL_NAME: z.string().optional(),
  SEED_ADMIN_EMPLOYEE_CODE: z.string().optional(),
  SEED_ADMIN_TELEGRAM_ID: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
