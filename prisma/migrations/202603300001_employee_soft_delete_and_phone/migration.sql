ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_ADD_USER_PHONE';

ALTER TABLE "employees"
  ADD COLUMN "phone_e164" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3);

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_phone_format_check"
  CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+998[0-9]{9}$');

DROP INDEX IF EXISTS "employees_telegram_id_key";
DROP INDEX IF EXISTS "employees_employee_code_key";

CREATE INDEX "employees_employee_code_idx" ON "employees"("employee_code");
CREATE INDEX "employees_telegram_id_idx" ON "employees"("telegram_id");
CREATE INDEX "employees_phone_e164_idx" ON "employees"("phone_e164");
CREATE INDEX "employees_deleted_active_idx" ON "employees"("deleted_at", "is_active");

CREATE UNIQUE INDEX "employees_employee_code_active_key"
  ON "employees"("employee_code")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "employees_telegram_id_active_key"
  ON "employees"("telegram_id")
  WHERE "deleted_at" IS NULL AND "telegram_id" IS NOT NULL;

CREATE UNIQUE INDEX "employees_phone_e164_active_key"
  ON "employees"("phone_e164")
  WHERE "deleted_at" IS NULL AND "phone_e164" IS NOT NULL;
