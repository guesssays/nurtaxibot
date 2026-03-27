# Deployment Guide

## 1. Create infrastructure

Required services:

- Netlify site
- PostgreSQL database
- Telegram bot token from BotFather

## 2. Configure environment variables

Fill the values from [.env.example](/A:/NURTAXIREGBOT/.env.example) in Netlify site environment settings.

Minimum production set:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_BASE_URL`
- `ADMIN_API_KEY`
- `APP_TIMEZONE`
- `ANTIFRAUD_FAST_REGISTRATION_SECONDS`
- `REMINDER_THRESHOLD_MINUTES`
- `REMINDER_REPEAT_MINUTES`
- `SEED_ADMIN_FULL_NAME`
- `SEED_ADMIN_EMPLOYEE_CODE`
- `SEED_ADMIN_TELEGRAM_ID`

`TELEGRAM_WEBHOOK_BASE_URL` must point to the Netlify functions base URL, for example:

```text
https://your-site.netlify.app/.netlify/functions
```

## 3. Install and build

```bash
npm install
npm run build
```

## 4. Run database migrations

```bash
npm run prisma:migrate:deploy
```

## 5. Seed the first admin

```bash
npm run seed
```

The seed script upserts the first admin by `SEED_ADMIN_EMPLOYEE_CODE`.

## 6. Deploy to Netlify

This project is already configured with [netlify.toml](/A:/NURTAXIREGBOT/netlify.toml).

Important Netlify configuration:

- functions directory: `netlify/functions`
- bundler: `esbuild`
- Prisma client files are included through `included_files`

## 7. Set Telegram webhook

After deploy, call:

```bash
curl -X POST "https://your-site.netlify.app/.netlify/functions/set-webhook" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-actor-telegram-id: YOUR_ADMIN_TELEGRAM_ID"
```

Expected webhook target:

```text
https://your-site.netlify.app/.netlify/functions/telegram-webhook
```

## 8. Validate deployment

### Healthcheck

```bash
curl "https://your-site.netlify.app/.netlify/functions/healthcheck"
```

### Report endpoint

```bash
curl "https://your-site.netlify.app/.netlify/functions/reports-daily" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-actor-telegram-id: YOUR_ADMIN_TELEGRAM_ID"
```

### Broadcast endpoints

```bash
curl "https://your-site.netlify.app/.netlify/functions/broadcasts-list?limit=10" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-actor-telegram-id: YOUR_ADMIN_TELEGRAM_ID"
```

```bash
curl "https://your-site.netlify.app/.netlify/functions/broadcasts-get?broadcastId=BROADCAST_ID" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-actor-telegram-id: YOUR_ADMIN_TELEGRAM_ID"
```

## 9. Scheduled functions

Configured schedules:

- daily report: `0 15 * * *` UTC
- reminders: `0 * * * *` UTC

For `Asia/Tashkent`:

- `0 15 * * *` UTC = 20:00 local time

Adjust the cron expressions in:

- [scheduled-daily-report.ts](/A:/NURTAXIREGBOT/netlify/functions/scheduled-daily-report.ts)
- [scheduled-registration-reminders.ts](/A:/NURTAXIREGBOT/netlify/functions/scheduled-registration-reminders.ts)

## 10. Operational recommendations

- rotate `ADMIN_API_KEY` and `TELEGRAM_WEBHOOK_SECRET`
- enable database backups
- restrict production DB access to Netlify egress rules where possible
- monitor Netlify function failures and Telegram webhook retries
- keep `npm test` and `npm run typecheck` in CI before deployment
