CREATE TYPE "BroadcastTargetType" AS ENUM (
  'ALL_ACTIVE_USERS',
  'ACTIVE_EMPLOYEES',
  'ACTIVE_ADMINS'
);

CREATE TYPE "BroadcastContentType" AS ENUM (
  'TEXT',
  'PHOTO',
  'VIDEO',
  'DOCUMENT'
);

CREATE TYPE "BroadcastStatus" AS ENUM (
  'DRAFT',
  'SENDING',
  'COMPLETED',
  'PARTIAL_FAILED',
  'CANCELLED',
  'FAILED'
);

CREATE TYPE "BroadcastDeliveryStatus" AS ENUM (
  'PENDING',
  'SENT',
  'FAILED',
  'SKIPPED'
);

ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_MENU';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_CHOOSE_TYPE';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_WAIT_TEXT';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_WAIT_PHOTO';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_WAIT_VIDEO';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_WAIT_DOCUMENT';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_WAIT_CAPTION';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_PREVIEW';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_CONFIRM_SEND';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_HISTORY';
ALTER TYPE "SessionState" ADD VALUE IF NOT EXISTS 'ADMIN_BROADCAST_VIEW_DETAILS';

ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'BROADCAST';

CREATE TABLE "broadcasts" (
  "id" TEXT NOT NULL,
  "created_by_employee_id" TEXT NOT NULL,
  "target_type" "BroadcastTargetType" NOT NULL,
  "content_type" "BroadcastContentType" NOT NULL,
  "text" TEXT,
  "caption" TEXT,
  "telegram_file_id" TEXT,
  "telegram_file_unique_id" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "file_size" INTEGER,
  "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
  "recipients_count" INTEGER NOT NULL DEFAULT 0,
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "error_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broadcasts_file_size_check" CHECK ("file_size" IS NULL OR "file_size" >= 0),
  CONSTRAINT "broadcasts_counts_check" CHECK (
    "recipients_count" >= 0
    AND "sent_count" >= 0
    AND "failed_count" >= 0
    AND "sent_count" + "failed_count" <= "recipients_count"
  ),
  CONSTRAINT "broadcasts_text_content_check" CHECK (
    ("content_type" <> 'TEXT') OR ("text" IS NOT NULL AND length(trim("text")) > 0)
  ),
  CONSTRAINT "broadcasts_media_content_check" CHECK (
    ("content_type" = 'TEXT')
    OR ("telegram_file_id" IS NOT NULL AND length(trim("telegram_file_id")) > 0)
  )
);

CREATE TABLE "broadcast_deliveries" (
  "id" TEXT NOT NULL,
  "broadcast_id" TEXT NOT NULL,
  "recipient_employee_id" TEXT,
  "telegram_id" BIGINT NOT NULL,
  "status" "BroadcastDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "telegram_message_id" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broadcast_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "broadcasts_created_by_created_at_idx" ON "broadcasts"("created_by_employee_id", "created_at");
CREATE INDEX "broadcasts_status_created_at_idx" ON "broadcasts"("status", "created_at");
CREATE INDEX "broadcast_deliveries_broadcast_id_idx" ON "broadcast_deliveries"("broadcast_id");
CREATE INDEX "broadcast_deliveries_status_idx" ON "broadcast_deliveries"("status");
CREATE INDEX "broadcast_deliveries_telegram_id_idx" ON "broadcast_deliveries"("telegram_id");
CREATE INDEX "broadcast_deliveries_broadcast_status_idx" ON "broadcast_deliveries"("broadcast_id", "status");

CREATE UNIQUE INDEX "broadcasts_single_draft_per_creator_key"
  ON "broadcasts"("created_by_employee_id")
  WHERE "status" = 'DRAFT';

CREATE UNIQUE INDEX "broadcast_deliveries_broadcast_telegram_key"
  ON "broadcast_deliveries"("broadcast_id", "telegram_id");

ALTER TABLE "broadcasts"
  ADD CONSTRAINT "broadcasts_created_by_employee_id_fkey"
  FOREIGN KEY ("created_by_employee_id")
  REFERENCES "employees"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "broadcast_deliveries"
  ADD CONSTRAINT "broadcast_deliveries_broadcast_id_fkey"
  FOREIGN KEY ("broadcast_id")
  REFERENCES "broadcasts"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "broadcast_deliveries"
  ADD CONSTRAINT "broadcast_deliveries_recipient_employee_id_fkey"
  FOREIGN KEY ("recipient_employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
