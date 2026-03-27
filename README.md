# WB Taxi Registration Bot

Production-ready Telegram bot for internal WB Taxi driver registration accounting and control.

## Stack

- TypeScript
- Telegram Bot API via webhook
- Netlify Functions
- PostgreSQL
- Prisma ORM
- `xlsx` for Excel export
- `dayjs` for dates and timezone formatting
- `zod` for validation
- `dotenv` + strict env parsing
- `vitest` for key business tests

## What is implemented

- employee/admin access by Telegram ID
- self-registration requests for unknown Telegram users
- admin approval/rejection flow for registration requests
- manual user creation by admin directly in Telegram
- RBAC for `EMPLOYEE`, `ADMIN`, `SUPERVISOR`
- single registration history table with full lifecycle
- race-safe start of registration
- anti-duplicate rules for `IN_PROGRESS` and `SUCCESS`
- employee FSM sessions persisted in PostgreSQL
- admin broadcast flow with text/photo/video/document delivery
- broadcast history and delivery-level result tracking
- employee Telegram flows for start / finish / error / cancel
- admin Telegram flows for reports, search, antifraud, broadcasts, active registrations and employee activation
- admin Telegram flows for user creation, registration request review and user toggling
- Netlify Functions for webhook, reports, exports, broadcasts, employees CRUD and healthcheck
- daily reports and reminder scheduled functions
- Excel export with multiple sheets
- audit logging for all key actions
- Prisma migrations + seed for first admin

## Project structure

```text
netlify/functions/
src/app/
src/domain/
src/lib/
src/repositories/
src/services/
src/transport/
prisma/schema.prisma
prisma/migrations/
prisma/seed.ts
docs/architecture.md
docs/deployment.md
tests/
```

## Quick start

1. Copy `.env.example` to `.env` and fill the real values.
2. Install dependencies:

```bash
npm install
```

3. Apply migrations:

```bash
npm run prisma:migrate:deploy
```

This now includes the migration for `user_registration_requests` and the new session/audit enum values used by self-registration flows.

4. Seed the first admin:

```bash
npm run seed
```

5. Start local Netlify dev server:

```bash
npm run dev
```

6. Register the Telegram webhook after deployment:

```bash
curl -X POST "https://YOUR-SITE.netlify.app/.netlify/functions/set-webhook" ^
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" ^
  -H "x-actor-telegram-id: YOUR_ADMIN_TELEGRAM_ID"
```

## Main scripts

- `npm run build` — Prisma generate
- `npm run dev` — Netlify local dev server
- `npm run typecheck` — TypeScript validation
- `npm test` — business tests
- `npm run prisma:migrate:deploy` — production migrations
- `npm run seed` — creates or updates the first admin

## Required environment variables

See [.env.example](/A:/NURTAXIREGBOT/.env.example).

Required in production:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_BASE_URL`
- `ADMIN_API_KEY`
- `APP_TIMEZONE`
- `ANTIFRAUD_FAST_REGISTRATION_SECONDS`
- `REMINDER_THRESHOLD_MINUTES`
- `REMINDER_REPEAT_MINUTES`

## Deployed function endpoints

- `/.netlify/functions/telegram-webhook`
- `/.netlify/functions/set-webhook`
- `/.netlify/functions/reports-daily`
- `/.netlify/functions/reports-range`
- `/.netlify/functions/export-excel`
- `/.netlify/functions/broadcasts-list`
- `/.netlify/functions/broadcasts-get`
- `/.netlify/functions/employees-list`
- `/.netlify/functions/employees-create`
- `/.netlify/functions/employees-update`
- `/.netlify/functions/antifraud-list`
- `/.netlify/functions/active-registrations`
- `/.netlify/functions/release-active-registration`
- `/.netlify/functions/healthcheck`
- `/.netlify/functions/scheduled-daily-report`
- `/.netlify/functions/scheduled-registration-reminders`

## Verification

Current local verification:

- `npm run typecheck`
- `npm test`

## Documentation

- [Architecture](/A:/NURTAXIREGBOT/docs/architecture.md)
- [Deployment](/A:/NURTAXIREGBOT/docs/deployment.md)
