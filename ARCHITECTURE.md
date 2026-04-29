# ARCHITECTURE.md — Postly

> Last updated to reflect the actual implemented state of the codebase.

---

## 1. System Overview

Postly is a multi-platform social media publishing backend. Users interact through a **Telegram** or **WhatsApp bot** to compose AI-generated content, preview it per platform, and publish or schedule it. There is no web dashboard — the bot is the entire interface.

Core capabilities:
- Stateful multi-step bot conversations (Telegram inline keyboards + WhatsApp numbered menus)
- AI content generation via OpenAI GPT-4o, Anthropic Claude Sonnet, with Groq Llama 3.3 as a final fallback
- Async publishing pipeline via BullMQ (one job per platform per post)
- Scheduled post delivery via node-cron
- Secure encrypted storage for social account tokens and user AI keys
- Soft-delete with restore, retry, and per-platform analytics

---

## 2. Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | ≥ 18 |
| Framework | Express | ^4.21 |
| ORM | Prisma | ^5.22 |
| Database | PostgreSQL | any |
| Cache / Sessions | redis (v4 client) | ^4.7 |
| Job Queue | BullMQ | ^5.76 |
| Cron | node-cron | ^4.2 |
| Telegram Bot | grammy | ^1.42 |
| WhatsApp Bot | Twilio SDK | ^5.3 |
| AI — OpenAI | openai | ^6.34 |
| AI — Anthropic | @anthropic-ai/sdk | ^0.91 |
| Auth | jsonwebtoken + bcrypt | ^9 / ^5 |
| Language detect | franc | ^6.2 |

---

## 3. Directory Structure

```
postly/
├── prisma/
│   ├── schema.prisma          ← all models, enums, indices
│   └── seed.js
├── src/
│   ├── app.js                 ← Express app, all route mounting
│   ├── server.js              ← HTTP server, startup verification, graceful shutdown
│   │
│   ├── config/
│   │   ├── env.js             ← validated typed config (fail-fast)
│   │   ├── prisma.js          ← Prisma client + soft-delete $use middleware
│   │   └── redis.js           ← redis v4 singleton + connectRedis()
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.js      ← requireAuth / attachUserIfPresent
│   │   ├── error.middleware.js     ← notFoundHandler / errorHandler
│   │   └── rateLimit.middleware.js ← Redis sliding window, fail-open
│   │
│   ├── routes/
│   │   ├── health.routes.js
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── oauth.routes.js
│   │   ├── content.routes.js
│   │   ├── posts.routes.js
│   │   ├── dashboard.routes.js
│   │   ├── telegram.routes.js
│   │   └── whatsapp.routes.js
│   │
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── user.controller.js
│   │   ├── content.controller.js
│   │   ├── oauth.controller.js
│   │   └── posts.controller.js
│   │
│   ├── services/
│   │   ├── auth.service.js        ← register, login, token rotation
│   │   ├── user.service.js        ← profile, social accounts, AI keys
│   │   ├── content.service.js     ← AI orchestration, language detection
│   │   ├── publish.service.js     ← enqueuePublishJobs, syncPostStatus
│   │   ├── posts.service.js       ← CRUD, soft delete, analytics cache
│   │   ├── openai.service.js      ← GPT-4o wrapper
│   │   ├── anthropic.service.js   ← Claude Sonnet wrapper
│   │   ├── groq.service.js        ← Groq Llama 3.3 wrapper (final fallback)
│   │   └── oauth.service.js       ← Twitter + LinkedIn OAuth flows
│   │
│   ├── queue/
│   │   ├── queue.js               ← BullMQ Queue singleton (ioredis connection)
│   │   ├── worker.js              ← BullMQ Worker, platform adapters, retry events
│   │   └── scheduler.js           ← node-cron every-minute dispatcher
│   │
│   ├── scripts/
│   │   └── setup-webhooks.js      ← one-shot Telegram webhook registration (run post-deploy)
│   │
│   ├── bot/
│   │   ├── botSession.js          ← platform-aware Redis session CRUD
│   │   ├── conversationService.js ← shared bot brain (all state/AI/publish logic)
│   │   ├── telegram/
│   │   │   ├── bot.js             ← grammy Bot init, webhook handler export
│   │   │   ├── handlers.js        ← Telegram adapter (thin, calls conversationService)
│   │   │   ├── stateMachine.js    ← state → { onText, onCallback } dispatch table
│   │   │   ├── keyboard.js        ← grammy InlineKeyboard builders
│   │   │   └── session.js         ← thin wrapper: bakes 'telegram' as the platform key
│   │   └── whatsapp/
│   │       ├── whatsapp.controller.js ← Twilio signature validation + TwiML response
│   │       └── whatsapp.service.js    ← number→action mapping, formatReply
│   │
│   └── utils/
│       ├── jwt.js                 ← signAccessToken, verifyAccessToken
│       ├── encryption.js          ← AES-256-GCM encrypt/decrypt
│       ├── hash.js                ← bcrypt, SHA-256, generateOpaqueToken
│       └── promptBuilder.js       ← platform-aware AI prompt construction
│
├── tests/                         ← Jest + Supertest test suite
├── __mocks__/
│   └── twilio.js                  ← auto-mock for Jest (no real Twilio calls in tests)
├── .env.example
├── package.json
└── ARCHITECTURE.md
```

---

## 4. Request Lifecycle

### 4.1 Express Middleware Stack (in order)

Every incoming HTTP request passes through these layers in sequence:

```
Incoming HTTP Request
        │
        ▼
  helmet()                  ← Sets security headers (CSP, HSTS, X-Frame-Options…)
        │
        ▼
  cors()                    ← Allows cross-origin requests
        │
        ▼
  express.json({ 1mb })     ← Parses JSON body; hard-capped at 1 MB
  express.urlencoded()      ← Parses form-encoded body (Twilio webhooks)
        │
        ▼
  morgan (non-test)         ← HTTP access logging; /health is skipped
        │
        ▼
  Route match
  ├─ /health            → health.routes.js    (no auth, no rate limit)
  ├─ /privacy, /terms   → legal.controller    (public, OAuth approval pages)
  ├─ /api/*
  │    ├─ attachUserIfPresent()   ← Decodes JWT silently; sets req.userId if valid
  │    ├─ rateLimit()             ← Redis counter keyed on user:{id} or ip:{ip}
  │    └─ route handler
  │         └─ requireAuth()      ← Rejects 401 if no valid JWT (protected routes only)
  ├─ /api/bot/telegram/webhook → grammy webhookCallback (validates secret header)
  └─ /api/bot/whatsapp         → Twilio signature validation → TwiML response
        │
        ▼
  notFoundHandler           ← Catches any unmatched route → 404
        │
        ▼
  errorHandler              ← Reads err.status/statusCode → { error: message }
                               Stack trace only in non-production
```

### 4.2 Controller Layer

Controllers are intentionally thin. Each one:
1. Extracts and coerces params from `req.body` / `req.params` / `req.query`
2. Calls exactly one service method
3. Returns `{ data }` or `{ data, meta }` — never raw Prisma objects

No business logic lives in controllers.

### 4.3 Service Layer

All business logic lives here. Services:
- Call Prisma for DB access
- Call Redis for cache / session / rate-limit operations
- Call BullMQ to enqueue jobs
- Call external APIs (AI providers, platform OAuth endpoints)
- Throw typed domain errors (`AuthError`, `ContentError`) with a `.status` property

---

## 5. Backend Pipeline Design

### 5.1 Authentication Pipeline

```
POST /api/auth/register
        │
        ▼
  auth.service.register()
  ├─ prisma.user.findUnique({ email })  ← 409 if already exists
  ├─ bcrypt.hash(password, 12)          ← slow hash, timing-safe
  ├─ prisma.user.create(...)
  ├─ signAccessToken(userId)            ← HS256 JWT, 15-min TTL
  └─ issueRefreshToken(userId)
       ├─ generateOpaqueToken()         ← 48 random bytes, base64url
       ├─ sha256(raw)                   ← only the hash goes to DB
       └─ prisma.refreshToken.create({ tokenHash, expiresAt: +7d })
        │
        ▼
  Response: { user, access_token, refresh_token }


POST /api/auth/login
        │
        ▼
  auth.service.login()
  ├─ prisma.user.findUnique({ email })
  │   └─ If not found: run dummy bcrypt compare anyway  ← prevents timing oracle
  ├─ bcrypt.compare(password, hash)
  ├─ 401 if invalid
  └─ issueTokenPair(userId) → { access_token, refresh_token }


POST /api/auth/refresh
        │
        ▼
  rotateRefreshToken(rawToken)
  ├─ sha256(rawToken) → look up in refresh_tokens
  ├─ 401 if not found (revoked or never issued)
  ├─ 401 if expiresAt <= now → delete stale row
  ├─ prisma.refreshToken.delete({ id })   ← invalidate before issuing
  └─ issueTokenPair(userId)               ← atomic rotation
```

**Key security properties:**
- Passwords stored as bcrypt (12 rounds), never raw
- Refresh tokens stored as SHA-256 hash only — raw token never persists
- Timing-safe login: dummy bcrypt compare runs even when user doesn't exist
- Refresh rotation is atomic: old token deleted before new pair issued

---

### 5.2 AI Content Generation Pipeline

```
POST /api/content/generate
  { idea, post_type, platforms[], tone, language?, model }
        │
        ▼
  content.service.generateContent(body, userId)
        │
        ├─ 1. VALIDATE INPUT
        │     ├─ idea: non-empty string, max 500 chars
        │     ├─ post_type: must be in VALID_POST_TYPES set
        │     ├─ platforms[]: non-empty, each must be in VALID_PLATFORMS set
        │     ├─ tone: must be in VALID_TONES set
        │     └─ model: 'openai' | 'anthropic'
        │
        ├─ 2. LANGUAGE DETECTION
        │     ├─ If language provided → use it
        │     └─ Else → franc(idea) → ISO 639-3 → ISO 639-1 mapping
        │               ('und' or short text → fallback 'en')
        │
        ├─ 3. RESOLVE AI KEYS
        │     └─ user.service.resolveAiKeys(userId)
        │           ├─ decrypt(user.ai_keys.openai_key_enc)   ← AES-256-GCM
        │           └─ decrypt(user.ai_keys.anthropic_key_enc)
        │
        ├─ 4. BUILD PROMPT
        │     └─ promptBuilder.buildPrompt({ idea, post_type, platforms, tone, language })
        │           ├─ System prompt: role, output format (JSON), platform rules
        │           └─ User prompt: the actual idea + constraints
        │               Platform rules embedded:
        │                 Twitter  → 280 chars, 2-3 hashtags, strong hook
        │                 LinkedIn → 800-1300 chars, 3-5 hashtags, professional
        │                 Instagram → no char limit, 10-15 hashtags, emojis
        │                 Threads  → 500 chars, 0-2 hashtags, conversational
        │
        └─ 5. FALLBACK CHAIN (runFallbackChain)
              │
              Attempt order:
              1. User's own key → requested model (openai or anthropic)
              2. System OPENAI_API_KEY → GPT-4o
              3. System ANTHROPIC_API_KEY → Claude Sonnet
              4. System GROQ_API_KEY → llama-3.3-70b-versatile
              │
              Per attempt:
              ├─ Call provider (up to 2 tries for malformed JSON)
              ├─ JSON parse raw response
              ├─ validateAiShape() — check each requested platform has non-empty content
              ├─ enforcePlatformRules() — truncate/clip if limits violated
              ├─ sanitiseHashtags() — ensure '#' prefix, strip invalid entries
              └─ If valid → return { generated, model_used, tokens_used }
                 If malformed JSON on try 1 → retry same provider
                 If transport/auth error → skip to next provider immediately
                 If all fail → ContentError 502
        │
        ▼
  Response: { generated: { twitter: {...}, linkedin: {...} }, model_used, tokens_used }
```

**Deduplication:** if the user's stored key is identical to the system key, `buildAttempts` uses a `seen` set (keyed on last 6 chars) to skip it — bad keys are never tried twice.

---

### 5.3 Publishing Pipeline (Immediate)

```
POST /api/posts/publish
  { idea, post_type, platforms: { twitter: { content }, linkedin: { content } }, tone? }
        │
        ▼
  posts.service.publishPost(userId, body)
        │
        ├─ Validate: idea non-empty, post_type valid, platforms non-empty object
        │   each platform's content non-empty string
        │
        ├─ prisma.$transaction([
        │     prisma.post.create({
        │       status: 'QUEUED',
        │       platformPosts: { createMany: [{ platform, content, status: 'PENDING' }, ...] }
        │     })
        │   ])
        │   └─ Atomic: post + all platform rows in one transaction
        │
        └─ publish.service.enqueuePublishJobs(postId, userId, platformPosts)
              │
              ├─ prisma.platformPost.updateMany(
              │     where: { id: { in: [...] }, status: 'PENDING' },
              │     data:  { status: 'QUEUED' }
              │   )
              │   └─ Idempotency guard: only PENDING rows are updated;
              │      QUEUED/PUBLISHED rows are untouched
              │
              └─ publishingQueue.add × N platforms (BullMQ)
                    payload: { platformPostId, postId, platform, userId }
                    options: { attempts: 3, backoff: exponential(1s→5s→25s),
                               removeOnComplete: 24h, removeOnFail: 7d }
        │
        ▼
  Response: { data: { post, platformPosts[] } }


BullMQ Worker picks up each job (concurrency = 5):
        │
        ├─ Step 1: prisma.platformPost.findUnique({ id: platformPostId })
        │   ├─ Not found → discard (post was deleted)
        │   └─ Already PUBLISHED → skip (idempotency guard)
        │
        ├─ Step 2: prisma.platformPost.update({ status: 'PUBLISHING', attempts: +1 })
        │   └─ Crash-safe: startup sweep resets stale PUBLISHING → QUEUED
        │
        ├─ Step 3: prisma.socialAccount.findUnique({ userId, platform })
        │   └─ Not found → UnrecoverableError (no retry — missing account won't appear)
        │
        ├─ Step 4: decrypt(socialAccount.accessTokenEnc)   ← AES-256-GCM
        │   └─ Decrypt error → UnrecoverableError
        │
        ├─ Step 5: platformAdapters[platform]({ accessToken, content })
        │   ├─ TWITTER   → mock (setTimeout 200ms) — real SDK pending
        │   ├─ LINKEDIN  → REAL: GET /v2/userinfo → resolve sub → POST /v2/ugcPosts
        │   │               UnrecoverableError on 401/403 (bad token, no retry)
        │   ├─ INSTAGRAM → mock
        │   ├─ THREADS   → mock
        │   └─ FACEBOOK  → mock
        │
        ├─ Step 6 (success):
        │   ├─ prisma.platformPost.update({ status: 'PUBLISHED', publishedAt, publishedUrl })
        │   └─ publish.service.syncPostStatus(postId)
        │         └─ aggregatePostStatus():
        │               all PUBLISHED  → post.status = 'PUBLISHED'
        │               all FAILED     → post.status = 'FAILED'
        │               mix            → post.status = 'PARTIAL'
        │               any in-flight  → no change (return null)
        │
        └─ Step 7 (failure):
              throw error → BullMQ applies backoff → retries up to 3 attempts
              After max retries (or UnrecoverableError):
              └─ worker.on('failed'):
                    prisma.platformPost.update({ status: 'FAILED', errorMessage })
                    syncPostStatus(postId)
```

---

### 5.4 Scheduled Post Pipeline

```
POST /api/posts/schedule
  { ..., publish_at: "2025-06-01T09:00:00Z" }
        │
        ▼
  posts.service.schedulePost(userId, body)
  ├─ Validate publish_at is a future date
  ├─ prisma.post.create({ status: 'SCHEDULED', publishAt, platformPosts: PENDING })
  └─ No jobs enqueued yet — cron handles dispatch


node-cron (every minute, '* * * * *')
        │
        ▼
  scheduler.dispatchDuePosts()
  ├─ prisma.post.findMany({
  │     where: { status: 'SCHEDULED', publishAt: { lte: now }, deletedAt: null },
  │     include: { platformPosts: { where: { status: 'PENDING' } } }
  │   })
  │
  └─ For each due post:
        ├─ prisma.post.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'QUEUED' } })
        │   └─ Optimistic lock: count=0 means another instance already claimed it → skip
        │
        └─ enqueuePublishJobs(postId, userId, platformPosts)
              └─ Same BullMQ flow as immediate publish
```

**Idempotency guarantees:** Status advance (SCHEDULED → QUEUED) happens before enqueue. If the cron fires again before the worker runs, it won't find the post (it's no longer SCHEDULED). If the process crashes after status advance but before enqueue, the post stays QUEUED with PENDING platform rows — a manual retry or future recovery sweep can re-enqueue.

---

### 5.5 Bot Conversation Pipeline

```
Telegram POST /api/bot/telegram/webhook
        │
        ├─ grammy webhookCallback validates X-Telegram-Bot-Api-Secret-Token
        ├─ Parses update: message (text/command) or callback_query (button press)
        │
        ├─ handlers.js extracts:
        │   ├─ Command: { command: 'start'|'link'|'status'|'help'|'restart'|'end', args[] }
        │   └─ Action:  { action: 'type:announcement' | 'platform:twitter' | … }
        │
        ├─ botSession.getSession('telegram', chatId)
        │   └─ Redis GET session:telegram:{chatId} → JSON.parse (or blank session)
        │
        ├─ conversationService.handleCommand() or .processMessage()
        │   └─ (see state machine below)
        │
        ├─ botSession.setSession('telegram', chatId, updatedSession)
        │   └─ Redis SET session:telegram:{chatId} EX 1800 (30-min TTL, reset on every write)
        │
        └─ Format response:
              options → grammy InlineKeyboard (keyboard.js)
              ctx.reply(text, { reply_markup: keyboard })


WhatsApp POST /api/bot/whatsapp
        │
        ├─ whatsapp.controller validates X-Twilio-Signature (HMAC-SHA1)
        ├─ Parses Twilio body: From, Body (user message text)
        │
        ├─ whatsapp.service.parseInput(body, session)
        │   └─ If body is a digit → session.pendingChoices[digit-1].value → action
        │      Else → command (starts with recognized keyword) or free text
        │
        ├─ conversationService (same as Telegram)
        │
        └─ Format response:
              options → numbered list: "1. Announcement\n2. Thread…"
              TwiML <Response><Message>text</Message></Response>


conversationService state machine:

  IDLE / unlinked
    /start → prompt to link account  (no JWT → no flow starts)
    /link <token> → verifyAccessToken(token) → session.userId = userId

  IDLE / linked
    /start or /restart → state = SELECT_TYPE, pendingChoices = TYPE_CHOICES

  SELECT_TYPE      → type:X received → state = SELECT_PLATFORMS
  SELECT_PLATFORMS → platform:X toggles selection; platform:done → state = SELECT_TONE
  SELECT_TONE      → tone:X → state = SELECT_MODEL
  SELECT_MODEL     → model:X → state = AWAIT_IDEA
  AWAIT_IDEA       → free text (≤500 chars) → state = GENERATING
  GENERATING       → content.service.generateContent() → state = PREVIEW
                     (rejects new messages while generating)
  PREVIEW          → action:post_now   → posts.service.publishPost() → IDLE
                   → action:edit_idea  → AWAIT_IDEA
                   → action:cancel     → IDLE
```

---

### 5.6 OAuth Connection Pipeline

```
GET /api/oauth/twitter/connect  (requires JWT)
        │
        ├─ Generate PKCE pair: code_verifier (random 64 bytes) + code_challenge (S256)
        ├─ Generate CSRF state (128-bit random hex)
        ├─ redis.set(`oauth:twitter:state:{state}`, JSON({ userId, codeVerifier }), EX 600)
        └─ Redirect → Twitter authorization URL with state + code_challenge


GET /api/oauth/twitter/callback  (no auth — userId recovered from Redis)
        │
        ├─ Verify state param → redis.get + redis.del (one-time use, 10-min window)
        ├─ Exchange code → access_token + refresh_token (Twitter OAuth 2.0 PKCE)
        ├─ encrypt(accessToken) + encrypt(refreshToken)  ← AES-256-GCM
        └─ prisma.socialAccount.upsert({ userId, platform: 'TWITTER', accessTokenEnc, … })


LinkedIn flow is identical except PKCE is not used (LinkedIn uses state-only OAuth 2.0).
```

---

## 6. Database Schema

### Models

**`users`**
```
id              UUID PK
email           UNIQUE
password_hash
name
bio             nullable
default_tone    nullable
default_language nullable
created_at
updated_at
```

**`refresh_tokens`**
```
id          UUID PK
user_id     FK → users
token_hash  UNIQUE (SHA-256 of raw token — never store raw)
expires_at
created_at
```

**`social_accounts`**
```
id                UUID PK
user_id           FK → users
platform          TWITTER | LINKEDIN | INSTAGRAM | FACEBOOK | THREADS
access_token_enc  AES-256-GCM encrypted
refresh_token_enc nullable
handle
connected_at
UNIQUE (user_id, platform)
```

**`ai_keys`**
```
id               UUID PK
user_id          UNIQUE FK → users
openai_key_enc   nullable, encrypted
anthropic_key_enc nullable, encrypted
updated_at
```

**`posts`**
```
id          UUID PK
user_id     FK → users
idea        TEXT  (original user idea)
post_type   TEXT | IMAGE | VIDEO | CAROUSEL
tone        nullable
language    nullable
model_used  nullable
publish_at  nullable  (scheduled posts only)
status      DRAFT | SCHEDULED | QUEUED | PUBLISHED | PARTIAL | FAILED | CANCELED
deleted_at  nullable  (soft delete — NULL = active)
created_at
INDICES: user_id, status, publish_at, deleted_at
```

**`platform_posts`**
```
id            UUID PK
post_id       FK → posts
platform      TWITTER | LINKEDIN | INSTAGRAM | FACEBOOK | THREADS
content       TEXT  (AI-generated, platform-specific)
status        PENDING | QUEUED | PUBLISHING | PUBLISHED | FAILED
published_at  nullable
published_url nullable
error_message nullable
attempts      INT default 0
INDICES: post_id, status
```

### Post Status State Machine

```
DRAFT ──────────────────────────────────────────────┐
SCHEDULED ──(cron fires)──────────────────────────┐ │
                                                  ▼ ▼
                                               QUEUED
                                                  │
                                   (worker picks up per platform)
                                                  │
                                             PUBLISHING
                                            ╱           ╲
                                     success             failure (retry)
                                        │                    │
                                   PUBLISHED              (backoff)
                                        │                    │
                                        └────────┬───────────┘
                                                 ▼
                                    syncPostStatus (parent post)
                                    ├─ all PUBLISHED  → PUBLISHED
                                    ├─ all FAILED     → FAILED
                                    └─ mix            → PARTIAL
```

### Soft Delete — Prisma Middleware

`src/config/prisma.js` registers a `$use` middleware that injects `WHERE deleted_at IS NULL` into every `Post` read operation (`findFirst`, `findMany`, `count`, `aggregate`, `groupBy`). It also downgrades `findUnique` → `findFirst` when the extra field makes the query non-unique.

To query deleted posts explicitly, include `deletedAt: { not: null }` in the where clause — the middleware detects this and skips injection.

---

## 7. Authentication & Security

### JWT Strategy

| Token | Format | Expiry | Storage |
|---|---|---|---|
| Access token | JWT (HS256, payload: `{sub: userId}`) | 15 min (configurable) | Client header |
| Refresh token | Opaque random (48 bytes, base64url) | 7 days (configurable) | Client + DB (SHA-256 hash only) |

**Refresh rotation:** on `/api/auth/refresh`, the old token is deleted atomically before the new pair is issued. A replayed revoked token gets a 401 immediately.

### Encryption

All sensitive data at rest uses **AES-256-GCM**:
- IV: 96-bit random per encryption call
- Auth tag: 128-bit (tamper detection)
- Envelope: `base64(JSON({ iv, authTag, content }))`
- Key: `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes), validated at startup

Decryption happens only at point of use (just before a platform API call or AI generation).

### Rate Limiting

Redis-backed sliding window counter. Key: `rl:user:{userId}` or `rl:ip:{ip}`. Fail-open — if Redis is unreachable, requests pass through. Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.

### Webhook Security

| Platform | Mechanism |
|---|---|
| Telegram | `X-Telegram-Bot-Api-Secret-Token` header validated by grammy's `webhookCallback` |
| WhatsApp | `X-Twilio-Signature` HMAC-SHA1 validated via `twilio.validateRequest()` |

For Telegram: when `TELEGRAM_BOT_TOKEN` is not set the entire bot module is disabled and the route returns 503. The secret-header validation (`TELEGRAM_WEBHOOK_SECRET`) is optional — skipped when the var is absent.

For WhatsApp: signature validation runs only when `TWILIO_AUTH_TOKEN` is set. Without it, all requests are accepted (development mode).

---

## 8. Bot Architecture

### Shared Conversation Brain

```
conversationService.js
  handleCommand({ command, args, platform, chatId, session })
  processMessage({ platform, chatId, session, action, text })

  Returns: { replyText, options, choicesType, updatedSession }
```

`conversationService` is completely platform-agnostic. It manages all state transitions, calls the AI engine, triggers publishing, and persists the session. It has no knowledge of grammy, Twilio, TwiML, or HTTP.

### Adapter Pattern

```
Telegram adapter (handlers.js)       WhatsApp adapter (whatsapp.service.js)
──────────────────────────────────    ──────────────────────────────────────────
Parse ctx → { action, text }          Parse Twilio body → { command?, action?, text? }
                                      Map "1","2"… → action via session.pendingChoices
                                      (numbers stored as pendingChoices on every step)
        ↓                                         ↓
  conversationService                    conversationService
        ↓                                         ↓
Build InlineKeyboard from              Format numbered list from
choicesType + keyboards.js             result.options
        ↓                                         ↓
ctx.reply / ctx.editMessageText        TwiML <Message>
```

### Bot State Machine

```
IDLE
  │ /start (linked user)
  ▼
SELECT_TYPE        ← inline buttons (Telegram) / numbered list (WhatsApp)
  │ type:X
  ▼
SELECT_PLATFORMS   ← multi-toggle (Telegram) / toggle by number + "done" (WhatsApp)
  │ platform:done
  ▼
SELECT_TONE        ← inline buttons / numbered list
  │ tone:X
  ▼
SELECT_MODEL       ← GPT-4o or Claude Sonnet
  │ model:X
  ▼
AWAIT_IDEA         ← free text input (max 500 chars)
  │ text received
  ▼
GENERATING         ← transient: AI call in progress (rejects new messages)
  │ success / failure
  ▼
PREVIEW            ← shows generated content per platform
  │
  ├─ action:post_now   → publishPost() → IDLE
  ├─ action:edit_idea  → AWAIT_IDEA
  └─ action:cancel     → IDLE
```

### Session Schema

Stored at `session:{platform}:{chatId}` in Redis, TTL 30 minutes, reset on every write.

```json
{
  "userId":           "uuid or null",
  "state":            "IDLE",
  "contentType":      "announcement | thread | story | …",
  "platforms":        ["twitter", "linkedin"],
  "tone":             "professional",
  "model":            "openai | anthropic",
  "idea":             "original user idea text",
  "generatedContent": { "twitter": { … }, "linkedin": { … } },
  "modelUsed":        "gpt-4o",
  "tokensUsed":       1420,
  "pendingChoices":   [ { "label": "…", "value": "…" } ]
}
```

`pendingChoices` is set by `conversationService` on every step that returns options. The WhatsApp adapter maps `"1"` → `pendingChoices[0].value` without any state-specific logic.

---

## 9. AI Content Engine

### Prompt Pipeline

```
content.service.generateContent(rawBody, userId)
  1. Validate input (idea ≤ 500 chars, valid enums)
  2. Detect language via franc (or use provided)
  3. Resolve AI keys: user's stored key → system .env fallback
  4. promptBuilder.buildPrompt({ idea, post_type, platforms, tone, language })
  5. Run the provider fallback chain (see "Fallback Strategy")
  6. Parse JSON response, validate shape, sanitise hashtags
  7. Return { generated, model_used, tokens_used }
```

### Fallback Strategy

Generation never depends on a single provider. `content.service` builds an
ordered attempt list and tries each provider in turn, moving on the moment one
fails. The system only returns an error when **every** configured provider has
been exhausted.

**Order of attempts:**

| # | Provider | Model | Key source |
|---|---|---|---|
| 1 | OpenAI or Anthropic | GPT-4o or Claude Sonnet 4.5 | User-provided key (matches the requested `model`) |
| 2 | OpenAI | GPT-4o | System `OPENAI_API_KEY` |
| 3 | Anthropic | Claude Sonnet 4.5 | System `ANTHROPIC_API_KEY` |
| 4 | Groq | `llama-3.3-70b-versatile` | System `GROQ_API_KEY` |

**JSON validation + retry.** Each provider response is parsed before being
accepted. If the model returns malformed JSON, the same provider is retried
once; on a second failure the chain advances to the next provider. Transport,
auth, or rate-limit errors skip the retry and fall through immediately.

**Why this design:**
- **Reliability** — a single provider outage (or a missing user key) never
  blocks content generation; Groq is a free, low-latency safety net.
- **Cost optimisation** — the user's own key is tried first so system-paid
  inference is reserved for users without keys; Groq's free tier absorbs
  spillover when the paid providers are unavailable.
- **Graceful degradation** — duplicate keys (e.g. user-supplied key matches the
  system key) are de-duped so a bad key isn't tried twice.

Failures are logged with the provider label only — never the key material.

### Platform Constraints

Defined in `src/utils/promptBuilder.js` — single source of truth:

| Platform | Limit | Hashtags | Notes |
|---|---|---|---|
| Twitter | 280 chars max | 2–3 | Punchy, strong hook |
| LinkedIn | 800–1300 chars | 3–5 | Always professional |
| Instagram | — | 10–15 | Hashtags at end, emojis |
| Threads | 500 chars max | 0–2 | Conversational |

### Key Resolution

`user.service.resolveAiKeys(userId)` decrypts the user's stored keys. If absent, the system falls back to `.env` keys. Keys are never returned through any HTTP response — only `has_openai_key: boolean` is exposed.

---

## 10. API Reference

All protected routes require `Authorization: Bearer <access_token>`.

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | — | Register; returns access + refresh tokens |
| POST | `/login` | — | Login; returns token pair |
| POST | `/refresh` | — | Rotate refresh token |
| POST | `/logout` | — | Invalidate refresh token |
| GET | `/me` | ✓ | Get current user profile |

### User — `/api/user`

| Method | Path | Description |
|---|---|---|
| GET | `/profile` | Fetch profile |
| PUT | `/profile` | Partial update (name, bio, default_tone, default_language) |
| POST | `/social-accounts` | Add / update social account (tokens encrypted) |
| GET | `/social-accounts` | List connected accounts (no token material) |
| DELETE | `/social-accounts/:id` | Remove account |
| GET | `/ai-keys` | Returns `{ has_openai_key, has_anthropic_key }` only |
| PUT | `/ai-keys` | Store / clear encrypted AI keys |

### OAuth — `/api/oauth`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/twitter/connect` | ✓ | Initiate Twitter OAuth 2.0 PKCE |
| GET | `/twitter/callback` | — | Twitter redirect; stores encrypted tokens |
| GET | `/linkedin/connect` | ✓ | Initiate LinkedIn OAuth |
| GET | `/linkedin/callback` | — | LinkedIn redirect |

### Content — `/api/content`

| Method | Path | Description |
|---|---|---|
| POST | `/generate` | AI generation (idea → platform content) |

### Posts — `/api/posts`

| Method | Path | Description |
|---|---|---|
| POST | `/publish` | Create + immediately enqueue |
| POST | `/schedule` | Create + set publishAt (cron dispatches) |
| GET | `/` | Paginated list (`page`, `limit`, `status`, `platform`, `date_from`, `date_to`) |
| GET | `/:id` | Post + all platform_post rows |
| POST | `/:id/retry` | Re-enqueue FAILED platform jobs only |
| DELETE | `/:id` | Soft delete (sets deleted_at, cancels pending jobs) |
| POST | `/:id/restore` | Restore soft-deleted post |
| GET | `/:id/analytics` | Engagement data; Redis-cached 5 min |

Response envelope: `{ data, meta }` for lists, `{ data }` for single items.

### Dashboard — `/api/dashboard`

| Method | Path | Description |
|---|---|---|
| GET | `/stats` | `{ total_posts, success_rate, posts_per_platform, by_status }` |

### Bot Webhooks (no JWT auth)

| Method | Path | Description |
|---|---|---|
| POST | `/api/bot/telegram/webhook` | Canonical production path registered with Telegram; grammy + secret header validation |
| POST | `/api/telegram/webhook` | Legacy alias — same router, kept for compatibility |
| POST | `/api/bot/whatsapp` | Twilio signature validation + TwiML response |

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Returns `{ status, uptime, timestamp, checks: { database, redis }, ai_providers: { openai, anthropic, groq } }`; 503 if either dependency is down |

---

## 11. Redis Usage

Two separate Redis connection strategies coexist in the same process:

| Usage | Client | Connection |
|---|---|---|
| Sessions, cache, rate limiting | `redis` v4 (`createClient`) | Lazy-connected via `connectRedis()` |
| BullMQ queue and worker | ioredis (via BullMQ internals) | Parsed from `REDIS_URL` as connection config object |

They cannot share the same client because BullMQ requires an ioredis-compatible interface.

### Keys

| Key pattern | TTL | Description |
|---|---|---|
| `session:{platform}:{chatId}` | 30 min | Bot conversation state |
| `analytics:{postId}` | 5 min | Cached engagement data |
| `rl:{user/ip}:{id}` | sliding window | Rate limit counters |
| `oauth:{platform}:state:{state}` | 10 min | OAuth CSRF state (PKCE code_verifier + userId); consumed on callback |

---

## 12. Error Handling

### HTTP Layer

`src/middlewares/error.middleware.js` — global error handler reads `err.status` or `err.statusCode` (default 500). Returns `{ error: message }`. Stack trace included only in non-production.

### Service Errors

Domain errors (AuthError, ContentError, UserError) carry a `.status` property and are passed to `next(err)` from controllers. The global handler serialises them.

### Bot Layer

The grammy `bot.catch()` handler and a try/catch in `whatsapp.controller` ensure the bot never crashes on handler errors — the user always gets a reply.

### Queue

Worker processor never swallows errors — always re-throws for BullMQ retry logic. The `worker.on('failed')` event (fires after all retries exhausted) is the single place that writes `FAILED` status to the DB.

### UnrecoverableError

BullMQ's `UnrecoverableError` is used for failures that retrying cannot fix:
- Social account not connected
- Token decryption failure
- Platform returns 401/403 (revoked token)
- No registered adapter for the platform

These skip all remaining retry attempts immediately.

---

## 13. Testing

**Stack:** Jest 29 + Supertest 7. Run with `npm test` or `npm run test:coverage`.

**Test files:**

| File | What it covers |
|---|---|
| `tests/auth.middleware.test.js` | Unit tests for `requireAuth` and `attachUserIfPresent` — valid token, expired, wrong secret, missing header |
| `tests/content.validation.test.js` | HTTP-level validation of POST /api/content/generate — all 400 error cases before AI is invoked |
| `tests/posts.publish.test.js` | POST /api/posts/publish: response structure + verifies one BullMQ job per platform; GET /api/posts/:id; paginated list |
| `tests/soft-delete.test.js` | DELETE + restore flow; verifies platformPost cancellation on delete, 404 on restore of active post |
| `tests/integration.test.js` | Full flow: register → login → wrong-password rejection → publish → fetch; uses stateful mocks to simulate real DB |

**Mocking strategy:**

- `src/config/prisma` and `src/config/redis` are replaced with jest.fn() mocks — no real DB or Redis required.
- `src/queue/queue` and `src/queue/worker` are mocked to prevent BullMQ from connecting to Redis at module load.
- `twilio` (node_modules) is intercepted by `__mocks__/twilio.js` — no network calls.
- bcrypt, JWT, and all service logic run for real against test-only env vars set in `tests/setup.js`.

---

## 14. Known Gaps & TODOs

1. **Platform adapters partially mocked** — LinkedIn uses the real `ugcPosts` API. Twitter, Instagram, Threads, and Facebook still use `setTimeout` mocks — replace with real SDK calls per platform.
2. **No webhook deduplication** — if Telegram/Twilio retries a delivery, the same message may be processed twice. An idempotency key per `message_id` would fix this.
3. **GENERATING state timeout** — if the server crashes mid-AI-call, `state` stays `GENERATING` in Redis until the 30-min TTL expires. A startup sweep could reset these, similar to the PUBLISHING → QUEUED reset in worker.js.
4. **Encryption key rotation** — no migration script to re-encrypt stored tokens if `ENCRYPTION_KEY` is rotated.
5. **Prisma `$use` is deprecated in Prisma 5** — the soft-delete middleware works but Prisma recommends migrating to Client Extensions. Not blocking; `$use` still functions.
6. **Cron precision** — posts scheduled at non-minute boundaries are delayed up to ~60 seconds.
7. **Single Redis instance** — BullMQ queue and session/cache share one Redis. An outage takes down both.
8. **No test database** — tests mock Prisma; real migration-level integration tests would require a separate `postly_test` Postgres instance.
9. **Scheduler crash gap** — if the process crashes after `post.status = QUEUED` but before BullMQ enqueue, the post is stuck QUEUED with PENDING platform rows until a manual retry or admin action.
