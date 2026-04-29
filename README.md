# Postly

**Multi-platform AI content publishing engine.** Users compose ideas via a chat bot, an AI engine drafts platform-specific content, and a worker fleet publishes (or schedules) the drafts to Twitter, LinkedIn, and beyond.

---

## Live URL

```
Base URL: https://credes-assesment.onrender.com
Health:   https://credes-assesment.onrender.com/health
```

---

## Tech stack

- Node.js 22 / Express
- PostgreSQL 16 (via Prisma ORM)
- Redis 7 (sessions, rate limiting, BullMQ queue)
- Docker / docker-compose
- Render (production hosting)
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

## Authentication

All protected endpoints require a `Bearer` token in the `Authorization` header. The flow is: **register → login → use the access token**.

### Register

```bash
curl -X POST https://credes-assesment.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "YourPassword123!"}'
```

Response:

```json
{
  "id": "clx...",
  "email": "you@example.com",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

### Login

```bash
curl -X POST https://credes-assesment.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "YourPassword123!"}'
```

Response:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a3f8c2...",
  "user": {
    "id": "clx...",
    "email": "you@example.com"
  }
}
```

Copy the `accessToken`. Pass it in every subsequent request:

```bash
curl https://credes-assesment.onrender.com/api/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

### Refresh a token

Access tokens expire after 15 minutes. Use the refresh token to get a new pair without re-logging in:

```bash
curl -X POST https://credes-assesment.onrender.com/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<refreshToken>"}'
```

The old refresh token is immediately invalidated and a new pair is returned.

> **Local development:** replace `https://credes-assesment.onrender.com` with `http://localhost:3000` in all examples above.

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
| `GROQ_API_KEY` | Optional | Final-fallback provider when OpenAI / Anthropic are unavailable |
| `NODE_ENV` | Yes | `production` in all deployed environments |
| `PORT` | Auto | Render injects this; defaults to `3000` |

---

## AI providers

Postly uses a three-tier fallback chain so content generation always succeeds
as long as at least one provider is reachable.

| Tier | Provider | Model | When it's used |
|---|---|---|---|
| 1 | **OpenAI** | `gpt-4o` | User's own key, then system `OPENAI_API_KEY` |
| 2 | **Anthropic** | `claude-sonnet-4-5` | User's own key, then system `ANTHROPIC_API_KEY` |
| 3 | **Groq** (fallback) | `llama-3.3-70b-versatile` | When the paid providers are unavailable |

Order of attempts per request:

1. User-provided key for the requested model (`openai` or `anthropic`)
2. System `OPENAI_API_KEY`
3. System `ANTHROPIC_API_KEY`
4. System `GROQ_API_KEY` (final fallback)

Each response is JSON-validated; a malformed response triggers one retry on the
same provider, after which the chain advances. The request only fails if every
configured provider fails.

### Setting up Groq (recommended)

1. Sign in at [console.groq.com](https://console.groq.com)
2. Create an API key under **API Keys**
3. Set the env var:

```
GROQ_API_KEY=gsk_...
```

`GROQ_API_KEY` is **optional** — if you don't set it, the chain simply ends at
Anthropic. With it set, the system stays available even when both paid
providers are down.

The `/health` endpoint reports which providers are configured:

```json
{
  "status": "ok",
  "ai_providers": { "openai": true, "anthropic": true, "groq": true }
}
```

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
BASE_URL=https://your-service.onrender.com
```

### 3. Register the webhook

After deploying, run the one-shot setup script:

```bash
# In the Render Shell for your service, or locally with prod env vars exported:
npm run setup:webhooks
```

This calls:
```
POST https://api.telegram.org/bot<TOKEN>/setWebhook
  { "url": "https://your-service.onrender.com/api/bot/telegram/webhook",
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
BASE_URL=https://your-service.onrender.com
```

### 3. Configure Twilio webhook

In the Twilio console, set the **incoming message webhook** for your WhatsApp number to:

```
POST https://your-service.onrender.com/api/bot/whatsapp
```

Twilio will sign every request with `X-Twilio-Signature`; the app validates this using `TWILIO_AUTH_TOKEN` and rejects unsigned requests with `403`.

---

## Deployment (Render)

### First deploy

1. Push this repository to GitHub
2. In the Render dashboard, create a new **Web Service** → **Build and deploy from a Git repository**, then select this repo
3. Set the runtime to **Docker** with Dockerfile path `docker/Dockerfile`
4. Provision a managed **PostgreSQL** instance and a **Key Value (Redis)** instance from the Render dashboard, then copy their connection strings into the web service's env vars as `DATABASE_URL` and `REDIS_URL`
5. Set all required environment variables in the web service settings (**Environment**)
6. Set the health check path to `/health`

### Environment variables to set in Render

```
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -hex 32>
BASE_URL=https://<your-service>.onrender.com
DATABASE_URL=<from Render Postgres>
REDIS_URL=<from Render Key Value>
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
TWILIO_ACCOUNT_SID=<from Twilio console>
TWILIO_AUTH_TOKEN=<from Twilio console>
TWILIO_WHATSAPP_NUMBER=whatsapp:+<number>
```

`PORT` is injected automatically by Render.

### Post-deploy steps

```bash
# Register the Telegram webhook (run once per environment)
# Open the Render Shell for your service, then:
npm run setup:webhooks
```

### Startup sequence

On every boot the server:
1. Verifies the PostgreSQL connection (`SELECT 1`)
2. Verifies the Redis connection (`PING`)
3. Applies any pending Prisma migrations (`prisma migrate deploy`)
4. Binds the HTTP port and starts the scheduler

If either connection fails at startup, the process exits with code 1 so Render can retry.

### Health check

```
GET /health
→ 200 { "status": "ok", "uptime": 42.1, "timestamp": "...", "checks": { "database": "ok", "redis": "ok" } }
→ 503 { "status": "degraded", ... }   ← if DB or Redis is unreachable
```

Render uses this endpoint to determine deployment health.

---

## Backend pipeline

### 1. Authentication flow

```
Register / Login
      │
      ▼
  bcrypt.hash(password)          ← 12 rounds, timing-safe dummy compare on unknown email
  JWT access token (15 min)      ← HS256, payload: { sub: userId }
  Refresh token (7 days)         ← 48 random bytes; only SHA-256 hash stored in DB
      │
      ▼
  Every protected request:
    Authorization: Bearer <access_token>
      └─ attachUserIfPresent → sets req.userId (fails silently)
      └─ requireAuth         → 401 if missing or invalid

  Token refresh (POST /api/auth/refresh):
    old token deleted atomically before new pair issued
    replayed revoked token → 401 immediately
```

---

### 2. AI content generation pipeline

```
POST /api/content/generate
  { idea, post_type, platforms[], tone, model }
      │
      ▼
  1. Validate — idea ≤ 500 chars, enums checked
  2. Language detect — franc() → ISO 639-1 (fallback: 'en')
  3. Resolve AI keys — user's encrypted key → system .env fallback
  4. Build prompt — platform rules embedded (char limits, hashtag counts)
  5. Fallback chain:
       ① User's own key  (openai or anthropic, as requested)
       ② System OpenAI   → GPT-4o
       ③ System Anthropic → Claude Sonnet
       ④ System Groq      → llama-3.3-70b-versatile
     Each attempt: parse JSON → validate shape → enforce platform rules
     Malformed JSON on attempt 1 → retry same provider once, then fall through
     Transport / auth error → skip to next provider immediately
  6. Return { generated: { twitter: {...}, linkedin: {...} }, model_used, tokens_used }
```

Platform rules enforced in the prompt (single source of truth in `promptBuilder.js`):

| Platform | Char limit | Hashtags | Style |
|---|---|---|---|
| Twitter | 280 | 2–3 | Punchy hook |
| LinkedIn | 800–1300 | 3–5 | Professional |
| Instagram | — | 10–15 | Emojis, hashtags at end |
| Threads | 500 | 0–2 | Conversational |

---

### 3. Publishing pipeline

```
POST /api/posts/publish
      │
      ▼
  Prisma transaction:
    post.create (status: QUEUED)
    platformPost.createMany × N (status: PENDING)
      │
      ▼
  enqueuePublishJobs():
    platformPost.updateMany → QUEUED   ← idempotency guard before enqueue
    BullMQ job × N platforms
    { attempts: 3, backoff: exponential 1s → 5s → 25s }
      │
      ▼
  BullMQ Worker (concurrency = 5) picks up each job:
    1. Load platformPost — discard if deleted, skip if already PUBLISHED
    2. Mark → PUBLISHING (crash-safe: startup resets stale PUBLISHING → QUEUED)
    3. Load social account → decrypt access token (AES-256-GCM)
    4. Call platform adapter:
         LinkedIn → real ugcPosts API
         Twitter, Instagram, Threads, Facebook → mocked (real SDK pending)
    5. Success → PUBLISHED → syncPostStatus()
       Failure → re-throw → BullMQ retries with backoff
       All retries exhausted → FAILED → syncPostStatus()
      │
      ▼
  syncPostStatus():
    all PUBLISHED  → post.status = PUBLISHED
    all FAILED     → post.status = FAILED
    mix            → post.status = PARTIAL
    any in-flight  → no change
```

---

### 4. Scheduled post pipeline

```
POST /api/posts/schedule  { ..., publish_at: "2025-06-01T09:00:00Z" }
      │
      ▼
  post.create (status: SCHEDULED, publishAt set)
  No jobs enqueued yet.
      │
      ▼
  node-cron fires every minute:
    Find posts WHERE status=SCHEDULED AND publishAt <= now AND deletedAt IS NULL
    For each due post:
      updateMany({ status: 'SCHEDULED' → 'QUEUED' })  ← optimistic lock
      count = 0 → already claimed by another instance → skip
      count > 0 → enqueuePublishJobs() → same worker flow as immediate publish
```

---

### 5. Bot pipeline (Telegram + WhatsApp)

Both bots share a single platform-agnostic brain (`conversationService.js`). The platform adapters only handle parsing input and formatting output.

```
Telegram webhook               WhatsApp webhook
      │                               │
  grammy validates              Twilio HMAC-SHA1
  secret header                 signature check
      │                               │
  Parse: command or             Parse: digit → map via
  callback_query action         session.pendingChoices
      │                               │
      └──────────┬────────────────────┘
                 ▼
  botSession.getSession()   ← Redis GET session:{platform}:{chatId}
                 │
                 ▼
  conversationService (state machine):
    IDLE → SELECT_TYPE → SELECT_PLATFORMS → SELECT_TONE
    → SELECT_MODEL → AWAIT_IDEA → GENERATING → PREVIEW
    → post_now → publishPost() → IDLE
                 │
  botSession.setSession()   ← Redis SET EX 1800 (30-min TTL)
                 │
  Format response:
    Telegram → InlineKeyboard + ctx.reply()
    WhatsApp → numbered list + TwiML <Message>
```

Session stored in Redis (`session:{platform}:{chatId}`) with 30-minute TTL, reset on every interaction. Holds full flow state: userId, selected type/platforms/tone/model, idea text, generated content, and `pendingChoices` for WhatsApp number mapping.

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
