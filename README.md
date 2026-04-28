# Postly

**Multi-platform AI content publishing engine.** Users compose ideas via a chat bot, an AI engine drafts platform-specific content, and a worker fleet publishes (or schedules) the drafts to Twitter, LinkedIn, and beyond.

---

## Live URL

```
Base URL: https://postly-production.up.railway.app
Health:   https://postly-production.up.railway.app/health
```

> Replace the hostname above with your actual Railway deployment URL once live.

---

## Tech stack

- Node.js 22 / Express
- PostgreSQL 16 (via Prisma ORM)
- Redis 7 (sessions, rate limiting, BullMQ queue)
- Docker / docker-compose
- Railway (production hosting)
- Telegram Bot API (Grammy, webhook mode)
- Twilio (WhatsApp webhook)

---

## Project layout

```
src/
  config/         env loading, Prisma client, Redis client
  controllers/    HTTP controllers
  services/       business logic
  routes/         route definitions
  middlewares/    auth, rate limiting, error handling
  bot/            Telegram and WhatsApp bot logic
  queue/          BullMQ worker, scheduler
  scripts/        one-shot operational scripts
  utils/          shared helpers
  app.js          Express app construction
  server.js       process entry point, graceful shutdown

prisma/
  schema.prisma   database schema
  seed.js         idempotent dev seed

docker/
  Dockerfile      multi-stage production image
docker-compose.yml  local dev stack (Postgres + Redis + app)
railway.toml        Railway deployment config
.env.example        all supported environment variables
```

---

## Quick start (local, Docker)

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — the defaults work out of the box with docker-compose **except** for secrets you must generate:

```bash
# JWT secret
openssl rand -base64 48

# Encryption key (must be 64 hex chars / 32 bytes)
openssl rand -hex 32

# Telegram webhook secret (optional but recommended)
openssl rand -hex 32
```

### 2. Start the full stack

```bash
docker-compose up --build
```

This boots PostgreSQL, Redis, and the API. The app container waits for Postgres to pass its health check, applies pending migrations, then starts the server.

Verify:

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":1.23,"timestamp":"...","checks":{"database":"ok","redis":"ok"}}
```

### 3. Seed sample data (optional)

```bash
docker-compose exec app npm run db:seed
```

---

## Environment variables

All variables are documented in [`.env.example`](.env.example). The table below covers the most important ones.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Signs JWT access tokens |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for OAuth token storage (64 hex chars) |
| `BASE_URL` | Prod | Public HTTPS URL — used for webhook registration and Twilio validation |
| `TELEGRAM_BOT_TOKEN` | Bot | Token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Bot | Protects the webhook endpoint from spoofed requests |
| `TWILIO_ACCOUNT_SID` | WhatsApp | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | WhatsApp | Twilio auth token for signature validation |
| `TWILIO_WHATSAPP_NUMBER` | WhatsApp | Sender number, e.g. `whatsapp:+14155238886` |
| `OPENAI_API_KEY` | Optional | System-level OpenAI fallback |
| `ANTHROPIC_API_KEY` | Optional | System-level Anthropic fallback |
| `NODE_ENV` | Yes | `production` in all deployed environments |
| `PORT` | Auto | Railway injects this; defaults to `3000` |

---

## Telegram bot setup

### 1. Create a bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the token (looks like `123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ`)

### 2. Set env vars

```
TELEGRAM_BOT_TOKEN=<your token>
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
BASE_URL=https://your-app.up.railway.app
```

### 3. Register the webhook

After deploying, run the one-shot setup script:

```bash
# In the Railway shell, or locally with prod env vars exported:
npm run setup:webhooks
```

This calls:
```
POST https://api.telegram.org/bot<TOKEN>/setWebhook
  { "url": "https://your-app.up.railway.app/api/bot/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>" }
```

The script prints current webhook info so you can verify registration succeeded.

**Webhook endpoint:** `POST /api/bot/telegram/webhook`

The bot uses **webhook mode only** — polling is never used in production.

---

## WhatsApp (Twilio) setup

### 1. Get Twilio credentials

- Sign up at [console.twilio.com](https://console.twilio.com)
- For testing, activate the **WhatsApp Sandbox** (Messaging → Try it out → Send a WhatsApp message)
- For production, provision a WhatsApp-enabled number

### 2. Set env vars

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
BASE_URL=https://your-app.up.railway.app
```

### 3. Configure Twilio webhook

In the Twilio console, set the **incoming message webhook** for your WhatsApp number to:

```
POST https://your-app.up.railway.app/api/bot/whatsapp
```

Twilio will sign every request with `X-Twilio-Signature`; the app validates this using `TWILIO_AUTH_TOKEN` and rejects unsigned requests with `403`.

---

## Deployment (Railway)

### First deploy

1. Push this repository to GitHub
2. Create a new Railway project → **Deploy from GitHub repo**
3. Add plugins: **PostgreSQL** and **Redis** — Railway injects `DATABASE_URL` and `REDIS_URL` automatically
4. Set all required environment variables in the Railway dashboard (Settings → Variables)
5. Railway detects `railway.toml` and builds using `docker/Dockerfile`

### Environment variables to set in Railway

```
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -hex 32>
BASE_URL=https://<your-railway-domain>
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
TWILIO_ACCOUNT_SID=<from Twilio console>
TWILIO_AUTH_TOKEN=<from Twilio console>
TWILIO_WHATSAPP_NUMBER=whatsapp:+<number>
```

`DATABASE_URL`, `REDIS_URL`, and `PORT` are set automatically by Railway plugins.

### Post-deploy steps

```bash
# Register the Telegram webhook (run once per environment)
# Open the Railway shell for your service, then:
npm run setup:webhooks
```

### Startup sequence

On every boot the server:
1. Verifies the PostgreSQL connection (`SELECT 1`)
2. Verifies the Redis connection (`PING`)
3. Applies any pending Prisma migrations (`prisma migrate deploy`)
4. Binds the HTTP port and starts the scheduler

If either connection fails at startup, the process exits with code 1 so Railway can retry.

### Health check

```
GET /health
→ 200 { "status": "ok", "uptime": 42.1, "timestamp": "...", "checks": { "database": "ok", "redis": "ok" } }
→ 503 { "status": "degraded", ... }   ← if DB or Redis is unreachable
```

Railway uses this endpoint to determine deployment health.

---

## API usage

See the full API reference in [`docs/content-generation-api.md`](docs/content-generation-api.md).

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Obtain access + refresh tokens |
| `POST` | `/api/content/generate` | Generate AI content for a platform |
| `POST` | `/api/posts` | Create a post (publish or schedule) |
| `GET` | `/api/dashboard` | Aggregated stats |
| `POST` | `/api/bot/telegram/webhook` | Telegram webhook (Telegram → app) |
| `POST` | `/api/bot/whatsapp` | Twilio WhatsApp webhook |
| `GET` | `/health` | Liveness + dependency check |

---

## Useful scripts

| Command | Purpose |
|---|---|
| `npm start` | Start the API in production mode |
| `npm run dev` | Start with nodemon (watch mode) |
| `npm run setup:webhooks` | Register Telegram webhook (run once after deploy) |
| `npm run prisma:migrate` | Create and apply a new migration (development) |
| `npm run prisma:deploy` | Apply existing migrations (production / CI) |
| `npm run db:seed` | Seed sample data |
| `npm run db:reset` | Drop and recreate the dev DB, then re-seed |

---

## Local development without Docker

You need local Postgres and Redis instances. Update `DATABASE_URL` and `REDIS_URL` in `.env`, then:

```bash
npm install
npm run prisma:migrate
npm run db:seed      # optional
npm run dev
```
