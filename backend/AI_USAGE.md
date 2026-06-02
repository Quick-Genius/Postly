# AI_USAGE.md — Postly

This document honestly describes how AI tools were used during the development of this project, what was generated versus written manually, and how the output was validated and refined.

---

## 1. Tools Used

| Tool | Version / Model | Purpose |
|---|---|---|
| **Claude Code** (Anthropic) | claude-sonnet-4-6 | Primary development assistant — architecture, implementation, debugging |
| **Claude API** (Anthropic) | claude-sonnet-4-5 | Integrated as one of the two AI content generation backends inside the product itself |

No GitHub Copilot or ChatGPT was used. All AI interaction was through Claude Code running in the terminal and VS Code extension.

---

## 2. Where AI Was Used

### 2.1 Initial Project Scaffold (PR 1)

**Prompt style used:**
> "Set up an Express.js project with Prisma, PostgreSQL, and Redis. Include a health check endpoint, multi-stage Dockerfile, and docker-compose for local dev. Use a non-root user in Docker."

**What was generated:**
- `docker-compose.yml` with health checks on both Postgres and Redis
- `docker/Dockerfile` (multi-stage, tini PID-1, non-root `app` user)
- `prisma/schema.prisma` base structure
- `src/app.js` and `src/server.js` skeletons
- `.env.example` initial version

**What I changed:**
- Added explicit `SIGTERM`/`SIGINT` handlers with a 10-second forced exit timeout in `server.js` — the initial version did `process.exit(0)` directly in the signal handler without waiting for in-flight requests.
- Removed the `x-powered-by` header (`app.disable('x-powered-by')`) — Claude's scaffold left it on.
- Added `app.set('trust proxy', 1)` for correct IP extraction behind Render's reverse proxy.

---

### 2.2 Authentication System (PR 2)

**Prompt style used:**
> "Implement JWT auth with short-lived access tokens and opaque refresh tokens. Store only the SHA-256 hash of the refresh token in Postgres. Use bcrypt for password hashing with timing-safe comparison on login failure."

**What was generated:**
- `src/services/auth.service.js` — register, login, rotateRefreshToken, logout
- `src/utils/jwt.js` and `src/utils/hash.js`
- `src/middlewares/auth.middleware.js` — `requireAuth` and `attachUserIfPresent`
- `prisma/schema.prisma` models for `User` and `RefreshToken`

**What I changed:**
- The initial `login` implementation returned early when the user didn't exist, which leaked account existence via response timing. I rewrote it to always call `bcrypt.compare` against a dummy hash regardless of whether the user exists.
- Changed `requireAuth` to split the `Authorization` header on the first space only, so tokens containing spaces don't silently fail.
- Separated `requireAuth` (hard reject) from `attachUserIfPresent` (soft attach) — Claude's initial version had only one middleware that rejected unauthenticated requests. `attachUserIfPresent` was needed so the rate limiter could key on `userId` for authenticated requests without forcing every route to be protected.

---

### 2.3 Encryption Utility (PR 3)

**Prompt style used:**
> "Write an AES-256-GCM encrypt/decrypt utility in Node.js. Use a fresh random 96-bit IV per call. Store the envelope as base64(JSON({iv, authTag, content})). Validate the key at module load time, not at call time."

**What was generated:**
- `src/utils/encryption.js` — complete implementation

**What I changed:**
- Added the `authTagLength: TAG_LENGTH` option to both `createCipheriv` and `createDecipheriv` — the initial version omitted this, which caused GCM to use the Node default (which can vary).
- Added an explicit `IV_LENGTH` check on decrypt to reject payloads with truncated IVs before the decipher runs.

---

### 2.4 AI Content Generation Engine (PR 5)

**Prompt style used:**
> "Build a content generation pipeline. Input: idea text, post_type, platforms (twitter/linkedin/instagram/threads), tone, model. Validate input. Detect language with franc. Build platform-aware prompts. Call OpenAI gpt-4o or Anthropic claude-sonnet-4-5. Parse the JSON response and normalize per-platform output shape."

**What was generated:**
- `src/utils/promptBuilder.js` — `PLATFORM_RULES`, `buildPrompt`
- `src/services/content.service.js` — full pipeline
- `src/services/openai.service.js` and `src/services/anthropic.service.js`

**What I changed:**
- The initial system prompt did not enforce LinkedIn's 800–1300 character range strongly enough. I added explicit character count instructions and a constraint that LinkedIn is always professional regardless of the requested tone.
- Claude initially returned hashtags as `string` in some platform blocks. I added `sanitiseHashtags()` to normalise them into `string[]` and prefix missing `#` characters.
- The `formatGeneratedContent()` function originally threw on a missing platform block. I changed it to insert a graceful placeholder (`{ content: '', error: '...' }`) so a model skip doesn't break the entire response.
- Added the `FRANC_TO_ISO1` mapping — Claude's initial version passed franc's ISO 639-3 codes directly to the prompt, which confused the model into generating content in the wrong language.

---

### 2.5 BullMQ Publishing Pipeline (PR 6)

**Prompt style used:**
> "Set up a BullMQ queue with one job per platform per post. Worker: load platformPost, mark PUBLISHING, decrypt accessToken, call platform adapter, mark PUBLISHED. On failure: throw (BullMQ retries). On exhausted retries: worker.on('failed') writes FAILED. Startup: reset stale PUBLISHING rows."

**What was generated:**
- `src/queue/queue.js` — Queue singleton with ioredis connection parsing
- `src/queue/worker.js` — Worker, platform adapters (mocked), event handlers
- `src/services/publish.service.js` — `enqueuePublishJobs`, `syncPostStatus`

**What I changed:**
- The initial version had the `failed` event handler calling `platformPost.update` (singular) by ID. Changed it to use the `platformPostId` from `job.data`, which required also ensuring `platformPostId` was included in the job payload — the initial scaffold only included `postId`.
- Added `err.permanent = true` on non-retryable errors (missing social account, bad encryption key) and checked for it in the `failed` event to skip unnecessary retry writes.
- Moved `JOB_ATTEMPTS` and `BACKOFF_CONFIG` into `publish.service.js` instead of `queue.js` — Claude put them in queue.js initially, but they belong alongside the enqueue logic since they're policy decisions, not infrastructure config.

---

### 2.6 Scheduler (PR 6)

**Prompt style used:**
> "Write a node-cron scheduler that fires every minute, finds SCHEDULED posts with publishAt <= now, and dispatches them. Use updateMany with status:SCHEDULED as an optimistic lock so two instances can't double-dispatch the same post."

**What was generated:**
- `src/queue/scheduler.js` — complete implementation

**What I changed:**
- The initial version called `prisma.post.update` (which always succeeds) before checking if another process had already claimed the post. Changed it to `updateMany` with `{ where: { id, status: 'SCHEDULED' } }` and check `count === 0` to detect a race condition.
- Added per-post error isolation with individual try/catch inside the `for` loop — the initial version had a single try/catch around the whole batch, meaning one bad post would abort all remaining ones.

---

### 2.7 Telegram + WhatsApp Bots (PR 7 & 8)

**Prompt style used:**
> "Build a stateful conversation bot for Telegram (Grammy, webhook mode only) and WhatsApp (Twilio). Both bots share a single platform-agnostic conversationService.js. Bot state is stored in Redis with a 30-minute TTL. States: IDLE → SELECT_TYPE → SELECT_PLATFORMS → SELECT_TONE → SELECT_MODEL → AWAIT_IDEA → GENERATING → PREVIEW."

**What was generated:**
- `src/bot/conversationService.js` — full state machine and all command handlers
- `src/bot/botSession.js` — Redis session store
- `src/bot/telegram/bot.js`, `handlers.js`, `stateMachine.js`, `keyboard.js`, `session.js`
- `src/bot/whatsapp/whatsapp.service.js` and `whatsapp.controller.js`

**What I changed:**
- Claude's initial `conversationService.js` had state-specific switch cases duplicated across Telegram and WhatsApp adapters. I refactored it into a single `conversationService` that returns `{ replyText, options, choicesType }` — the adapters format this output in their own way (inline keyboard vs numbered list).
- Added `pendingChoices` to the session schema — without this, the WhatsApp adapter had no way to map "1", "2" replies to structured action values across session reads.
- The WhatsApp controller initially reconstructed the full URL from `req.headers.host`. Changed it to use `env.baseUrl` — the host header is unreliable behind a reverse proxy.
- The Telegram bot initially used polling mode. Switched to `webhookCallback` with `secretToken` validation — polling would fail in production and leak the bot token in logs.

---

### 2.8 Production Configuration (PR 9)

**Prompt style used:**
> "Make the system deployable on Render. Add startup connection verification for DB and Redis. Add a one-shot webhook registration script. Update README with full deployment instructions."

**What was generated:**
- `src/scripts/setup-webhooks.js`
- Updated `README.md`

**What I changed:**
- Rewrote `server.js` to verify connections before binding the port. Claude's initial scaffold called `app.listen()` immediately and hoped the DB was available — if it wasn't, the first request would crash the worker rather than failing at startup.
- Added `BASE_URL` as the canonical env var (aliasing the existing `APP_URL`) so Telegram and Twilio webhook validation both use the same variable.

---

## 3. What I Modified vs. What AI Generated

| Area | Generated by AI | Modified / Added Manually |
|---|---|---|
| Auth timing-safe login | ✓ (generated logic) | Constant-time dummy comparison for non-existent users |
| Encryption | ✓ | `authTagLength` option, IV length check on decrypt |
| Prompt builder | ✓ | LinkedIn character enforcement, `sanitiseHashtags`, graceful missing-platform handling |
| BullMQ worker | ✓ | `err.permanent` pattern, job payload includes `platformPostId` |
| Scheduler | ✓ | Optimistic lock via `updateMany`, per-post error isolation |
| Bot conversation | ✓ | Shared `conversationService`, `pendingChoices` session field, webhook-only Telegram |
| ARCHITECTURE.md | ✓ (initial) | Refined after each PR to reflect actual implementation |
| Test suite | Partially ✓ | Test structure, mock factories, meaningful assertions beyond status codes |

---

## 4. Validation

### 4.1 How I tested AI-generated code

- **Ran the local docker-compose stack** after each PR and manually exercised every endpoint via curl and Postman.
- **Checked BullMQ job state** using `redis-cli` to inspect queue keys and confirm one job per platform was enqueued.
- **Tested the bot flows** end-to-end in the Telegram app (sandbox bot) to verify state transitions worked across session reloads.
- **Verified Twilio signatures** by sending forged webhook requests and confirming 403 responses.
- **Read every generated file** before committing it — nothing went in without being understood.

### 4.2 How I caught issues

- The timing-safe login flaw was found by reading `auth.service.js` and noticing the early return.
- The missing `platformPostId` in job payloads was caught when the worker's `failed` event handler threw a "Cannot read properties of undefined" error during a local test run.
- The LinkedIn character range issue was caught by generating content and reading the AI output — it routinely produced 400-character posts instead of the required 800–1300.

### 4.3 What wasn't changed

- The BullMQ exponential backoff config (1s → 5s → 25s) exactly matches the ARCHITECTURE.md spec — no adjustment was needed.
- The Prisma soft-delete middleware logic was accepted as-is after verifying that `findUnique` → `findFirst` downgrade correctly handles the unique-key constraint.
- The grammy `webhookCallback` integration was accepted as-is — Grammy's API is well-documented and the generated code matched the official examples exactly.

---

### 2.9 Groq Fallback Provider (PR 10)

**Prompt style used:**
> "Add Groq as a final fallback to the AI generation chain. Order: user key → system OpenAI → system Anthropic → Groq (`llama-3.3-70b-versatile`). Validate JSON, retry once on parse failure, then move to the next provider. Never log API keys."

**What was generated:**
- `src/services/groq.service.js` — OpenAI-SDK-compatible Groq client
- Fallback chain logic in `content.service.js`
- `ai_providers` block on `/health`

**Why this fallback was added:**
- **Reliability**: a single OpenAI or Anthropic outage previously made content generation unusable. With Groq as a free, always-on safety net, the system stays functional during paid-provider incidents.
- **Cost**: Groq's free tier absorbs traffic from users who haven't supplied their own keys, reducing system-paid OpenAI / Anthropic spend.
- **Latency**: Groq's Llama 3.3 70B is fast enough to be a viable last resort, not just an emergency degraded mode.

**Trade-offs:**
- Llama 3.3 70B occasionally produces lower-quality copy than GPT-4o or Claude — acceptable for a fallback but undesirable as a primary path. The chain only reaches Groq when earlier providers fail.
- Groq's JSON mode is reliable but Llama still wraps output in markdown fences sometimes — handled with the same `stripMarkdownFences` defensive parser used for Anthropic.
- One extra optional env var (`GROQ_API_KEY`) — if absent, the chain simply terminates at Anthropic with no behaviour change.

**What I changed:**
- Initial implementation called Groq via `fetch` directly. Switched to the `openai` SDK with a custom `baseURL` so error handling and JSON-mode semantics match the existing OpenAI service exactly.
- Added an internal de-duplication step inside the fallback chain — if a user happens to supply the same OpenAI key as the system, the same key is not tried twice.
- Logging emits the provider label and error message only; never the key.
