# Architecture

## Layers

### Transport layer

- Netlify Functions in `netlify/functions/*`
- Telegram webhook transport in [telegram-bot.ts](/A:/NURTAXIREGBOT/src/transport/telegram-bot.ts)
- thin HTTP/admin authorization helper in [http-admin.ts](/A:/NURTAXIREGBOT/src/transport/http-admin.ts)

### Application layer

- [registration.service.ts](/A:/NURTAXIREGBOT/src/services/registration.service.ts)
- [report.service.ts](/A:/NURTAXIREGBOT/src/services/report.service.ts)
- [export.service.ts](/A:/NURTAXIREGBOT/src/services/export.service.ts)
- [employee.service.ts](/A:/NURTAXIREGBOT/src/services/employee.service.ts)
- [broadcast.service.ts](/A:/NURTAXIREGBOT/src/services/broadcast.service.ts)
- [reminder.service.ts](/A:/NURTAXIREGBOT/src/services/reminder.service.ts)
- [notification.service.ts](/A:/NURTAXIREGBOT/src/services/notification.service.ts)

### Data layer

- Prisma client singleton in [prisma.ts](/A:/NURTAXIREGBOT/src/lib/prisma.ts)
- repositories in `src/repositories/*`
- schema in [schema.prisma](/A:/NURTAXIREGBOT/prisma/schema.prisma)
- raw SQL migration for partial unique indexes in [migration.sql](/A:/NURTAXIREGBOT/prisma/migrations/202603270001_init/migration.sql)

### Shared/domain layer

- enums, labels and menu constants in [constants.ts](/A:/NURTAXIREGBOT/src/domain/constants.ts)
- phone normalization in [phone.ts](/A:/NURTAXIREGBOT/src/lib/phone.ts)
- antifraud rules in [antifraud.ts](/A:/NURTAXIREGBOT/src/lib/antifraud.ts)
- report aggregation in [report-aggregation.ts](/A:/NURTAXIREGBOT/src/lib/report-aggregation.ts)
- RBAC in [rbac.ts](/A:/NURTAXIREGBOT/src/lib/rbac.ts)
- logger abstraction in [logger.ts](/A:/NURTAXIREGBOT/src/lib/logger.ts)

## Core database design

### Main tables

- `employees`
- `registrations`
- `audit_logs`
- `broadcasts`
- `broadcast_deliveries`
- `daily_report_snapshots`
- `user_sessions`

### Registration lifecycle

All history is stored in one table: `registrations`.

Supported statuses:

- `IN_PROGRESS`
- `SUCCESS`
- `ERROR`
- `CANCELLED`

Additional fields track who started, finished, failed or cancelled the registration, duration, antifraud flags and reminder state.

## Race-condition strategy

The start-registration path uses two protection layers:

1. PostgreSQL transaction with advisory locks by phone and employee.
2. Partial unique indexes:
   - one active or successful record per phone
   - one active record per employee

Important SQL indexes are created in the raw migration:

- `registrations_phone_active_or_success_key`
- `registrations_active_employee_key`

This prevents the classic “two employees started the same phone at the same time” scenario even under webhook retries or parallel function execution.

## FSM/session model

Telegram dialog state is persisted in `user_sessions`.

Main states:

- `IDLE`
- `CREATING_REGISTRATION_SELECT_SOURCE`
- `CREATING_REGISTRATION_ENTER_PHONE`
- `CREATING_REGISTRATION_CONFIRM_START`
- `ACTIVE_REGISTRATION_ACTIONS`
- `MARK_ERROR_SELECT_REASON`
- `MARK_ERROR_ENTER_COMMENT`
- `ADMIN_SEARCH_PHONE`
- `ADMIN_EXPORT_SELECT_PERIOD`
- `ADMIN_REPORT_SELECT_FILTERS`
- `ADMIN_RELEASE_ENTER_REASON`

State is reset after successful completion/error/cancel/release flows, so employees cannot continue searching or viewing a finished number.

Additional admin-only broadcast states cover draft creation, media upload, caption editing, preview, history and details screens.

## Security model

### Telegram access

- user is resolved strictly by Telegram ID
- inactive or unknown users are denied
- employee sees only own active registration and own daily stats

### HTTP admin access

All admin functions require:

- `x-admin-api-key`
- `x-actor-telegram-id`
- role validation against `ADMIN` or `SUPERVISOR`, depending on endpoint

### Webhook protection

`telegram-webhook` checks `x-telegram-bot-api-secret-token`.

## Reporting/export

Reports are built from registrations in a date range and aggregated into:

- totals
- source split
- employee split
- conversion
- fast registration counters

Excel export generates sheets for:

1. successful registrations
2. errors
3. in-progress registrations
4. employees
5. summary
6. antifraud

## Broadcast subsystem

Admin-only mass messaging is implemented as a separate bounded flow:

- draft metadata is stored in `broadcasts`
- per-recipient outcomes are stored in `broadcast_deliveries`
- recipients are resolved from active employees with Telegram IDs and deduplicated by `telegramId`
- sending uses Telegram `file_id` reuse for photo/video/document broadcasts
- long media captions are automatically sent as follow-up text messages after the media
- final statuses are `COMPLETED`, `PARTIAL_FAILED`, `FAILED` or `CANCELLED`

The service is reusable from both Telegram UI and HTTP endpoints:

- [broadcasts-list.ts](/A:/NURTAXIREGBOT/netlify/functions/broadcasts-list.ts)
- [broadcasts-get.ts](/A:/NURTAXIREGBOT/netlify/functions/broadcasts-get.ts)

## Scheduled jobs

- [scheduled-daily-report.ts](/A:/NURTAXIREGBOT/netlify/functions/scheduled-daily-report.ts)
- [scheduled-registration-reminders.ts](/A:/NURTAXIREGBOT/netlify/functions/scheduled-registration-reminders.ts)

These are ready for Netlify Scheduled Functions and use UTC-based cron expressions.
