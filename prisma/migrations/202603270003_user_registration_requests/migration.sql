CREATE TYPE "UserRegistrationRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_USER_MENU';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_ADD_USER_TELEGRAM_ID';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_ADD_USER_FULL_NAME';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_ADD_USER_EMPLOYEE_CODE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_ADD_USER_ROLE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_ADD_USER_IS_ACTIVE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_ADD_USER_PREVIEW';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_REGISTRATION_REQUESTS_LIST';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_REGISTRATION_REQUEST_DETAIL';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_REGISTRATION_APPROVE_ROLE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_REGISTRATION_APPROVE_EMPLOYEE_CODE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_REGISTRATION_APPROVE_CONFIRM';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_REGISTRATION_REJECT_COMMENT';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'GUEST_REGISTRATION_FULL_NAME';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'GUEST_REGISTRATION_EMPLOYEE_CODE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'GUEST_REGISTRATION_PHONE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'GUEST_REGISTRATION_ROLE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'GUEST_REGISTRATION_COMMENT';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'GUEST_REGISTRATION_PREVIEW';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'GUEST_REGISTRATION_STATUS';

ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'USER_REGISTRATION_REQUEST';

CREATE TABLE "user_registration_requests" (
  "id" TEXT NOT NULL,
  "telegram_id" BIGINT NOT NULL,
  "username" TEXT,
  "first_name" TEXT,
  "last_name" TEXT,
  "full_name" TEXT NOT NULL,
  "phone" TEXT,
  "requested_role" "EmployeeRole",
  "employee_code" TEXT,
  "comment" TEXT,
  "status" "UserRegistrationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_employee_id" TEXT,
  "review_comment" TEXT,
  "approved_employee_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  CONSTRAINT "user_registration_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_registration_requests_status_created_at_idx"
  ON "user_registration_requests"("status", "created_at");

CREATE INDEX "user_registration_requests_telegram_created_at_idx"
  ON "user_registration_requests"("telegram_id", "created_at");

CREATE UNIQUE INDEX "user_registration_requests_single_pending_per_telegram_key"
  ON "user_registration_requests"("telegram_id")
  WHERE "status" = 'PENDING';

ALTER TABLE "user_registration_requests"
  ADD CONSTRAINT "user_registration_requests_reviewed_by_employee_id_fkey"
  FOREIGN KEY ("reviewed_by_employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "user_registration_requests"
  ADD CONSTRAINT "user_registration_requests_approved_employee_id_fkey"
  FOREIGN KEY ("approved_employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
