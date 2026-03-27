process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/wb_taxi_bot?schema=public";
process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.TELEGRAM_WEBHOOK_SECRET ??= "test-secret";
process.env.TELEGRAM_WEBHOOK_BASE_URL ??= "https://example.netlify.app/.netlify/functions";
process.env.ADMIN_API_KEY ??= "test-admin-key";
process.env.APP_TIMEZONE ??= "Asia/Tashkent";
