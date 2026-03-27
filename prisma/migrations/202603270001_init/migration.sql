CREATE TYPE "EmployeeRole" AS ENUM ('EMPLOYEE', 'ADMIN', 'SUPERVISOR');
CREATE TYPE "RegistrationSource" AS ENUM ('TELEGRAM', 'SITE', 'OFFLINE');
CREATE TYPE "RegistrationStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'ERROR', 'CANCELLED');
CREATE TYPE "RegistrationErrorReason" AS ENUM (
  'ALREADY_REGISTERED_IN_OTHER_PARK',
  'DUPLICATE',
  'INVALID_DOCUMENTS',
  'CLIENT_CHANGED_MIND',
  'OTHER'
);
CREATE TYPE "AntifraudReason" AS ENUM ('REGISTRATION_TOO_FAST');
CREATE TYPE "CancelReason" AS ENUM ('EMPLOYEE_CANCELLED', 'ADMIN_RELEASE');
CREATE TYPE "SessionState" AS ENUM (
  'IDLE',
  'CREATING_REGISTRATION_SELECT_SOURCE',
  'CREATING_REGISTRATION_ENTER_PHONE',
  'CREATING_REGISTRATION_CONFIRM_START',
  'ACTIVE_REGISTRATION_ACTIONS',
  'EMPLOYEE_SEARCH_ACTIVE_PHONE',
  'MARK_ERROR_SELECT_REASON',
  'MARK_ERROR_ENTER_COMMENT',
  'ADMIN_SEARCH_PHONE',
  'ADMIN_EXPORT_SELECT_PERIOD',
  'ADMIN_REPORT_SELECT_FILTERS',
  'ADMIN_RELEASE_ENTER_REASON'
);
CREATE TYPE "AuditEntityType" AS ENUM ('EMPLOYEE', 'REGISTRATION', 'SESSION', 'REPORT', 'SYSTEM');

CREATE TABLE "employees" (
  "id" TEXT NOT NULL,
  "telegram_id" BIGINT,
  "employee_code" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "role" "EmployeeRole" NOT NULL DEFAULT 'EMPLOYEE',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "registrations" (
  "id" TEXT NOT NULL,
  "phone_e164" TEXT NOT NULL,
  "source" "RegistrationSource" NOT NULL,
  "status" "RegistrationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "started_by_employee_id" TEXT NOT NULL,
  "finished_by_employee_id" TEXT,
  "error_by_employee_id" TEXT,
  "cancelled_by_employee_id" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "error_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "duration_seconds" INTEGER,
  "antifraud_flag" BOOLEAN NOT NULL DEFAULT false,
  "antifraud_reason" "AntifraudReason",
  "error_reason" "RegistrationErrorReason",
  "error_comment" TEXT,
  "cancel_reason" "CancelReason",
  "cancel_comment" TEXT,
  "last_reminder_at" TIMESTAMP(3),
  "reminder_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registrations_phone_format_check" CHECK ("phone_e164" ~ '^\+998[0-9]{9}$'),
  CONSTRAINT "registrations_duration_check" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
  CONSTRAINT "registrations_status_success_check" CHECK (
    ("status" <> 'SUCCESS')
    OR (
      "finished_at" IS NOT NULL
      AND "finished_by_employee_id" IS NOT NULL
      AND "duration_seconds" IS NOT NULL
      AND "error_at" IS NULL
      AND "cancelled_at" IS NULL
      AND "error_reason" IS NULL
      AND "cancel_reason" IS NULL
    )
  ),
  CONSTRAINT "registrations_status_error_check" CHECK (
    ("status" <> 'ERROR')
    OR (
      "error_at" IS NOT NULL
      AND "error_by_employee_id" IS NOT NULL
      AND "error_reason" IS NOT NULL
      AND "duration_seconds" IS NOT NULL
      AND "finished_at" IS NULL
      AND "cancelled_at" IS NULL
      AND "cancel_reason" IS NULL
    )
  ),
  CONSTRAINT "registrations_status_cancelled_check" CHECK (
    ("status" <> 'CANCELLED')
    OR (
      "cancelled_at" IS NOT NULL
      AND "cancelled_by_employee_id" IS NOT NULL
      AND "cancel_reason" IS NOT NULL
      AND "finished_at" IS NULL
      AND "error_at" IS NULL
      AND "error_reason" IS NULL
    )
  ),
  CONSTRAINT "registrations_error_other_comment_check" CHECK (
    ("error_reason" <> 'OTHER')
    OR ("error_comment" IS NOT NULL AND length(trim("error_comment")) > 0)
  )
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" "AuditEntityType" NOT NULL,
  "entity_id" TEXT,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_report_snapshots" (
  "id" TEXT NOT NULL,
  "report_date" DATE NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_report_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "telegram_id" BIGINT NOT NULL,
  "employee_id" TEXT,
  "state" "SessionState" NOT NULL DEFAULT 'IDLE',
  "data_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employees_telegram_id_key" ON "employees"("telegram_id");
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");
CREATE UNIQUE INDEX "daily_report_snapshots_report_date_key" ON "daily_report_snapshots"("report_date");
CREATE UNIQUE INDEX "user_sessions_telegram_id_key" ON "user_sessions"("telegram_id");

CREATE INDEX "registrations_phone_e164_idx" ON "registrations"("phone_e164");
CREATE INDEX "registrations_status_started_at_idx" ON "registrations"("status", "started_at");
CREATE INDEX "registrations_started_by_status_idx" ON "registrations"("started_by_employee_id", "status");
CREATE INDEX "registrations_antifraud_started_at_idx" ON "registrations"("antifraud_flag", "started_at");
CREATE INDEX "registrations_last_reminder_status_idx" ON "registrations"("last_reminder_at", "status");
CREATE INDEX "audit_logs_employee_created_at_idx" ON "audit_logs"("employee_id", "created_at");
CREATE INDEX "audit_logs_entity_lookup_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "user_sessions_employee_id_idx" ON "user_sessions"("employee_id");

CREATE UNIQUE INDEX "registrations_phone_active_or_success_key"
  ON "registrations"("phone_e164")
  WHERE "status" IN ('IN_PROGRESS', 'SUCCESS');

CREATE UNIQUE INDEX "registrations_active_employee_key"
  ON "registrations"("started_by_employee_id")
  WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_started_by_employee_id_fkey"
  FOREIGN KEY ("started_by_employee_id")
  REFERENCES "employees"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_finished_by_employee_id_fkey"
  FOREIGN KEY ("finished_by_employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_error_by_employee_id_fkey"
  FOREIGN KEY ("error_by_employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_cancelled_by_employee_id_fkey"
  FOREIGN KEY ("cancelled_by_employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_employee_id_fkey"
  FOREIGN KEY ("employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_employee_id_fkey"
  FOREIGN KEY ("employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
