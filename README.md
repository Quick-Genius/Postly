# Postly

**Multi-platform AI content publishing engine.** Users compose ideas via a chat bot, an AI engine drafts platform-specific content, and a worker fleet publishes (or schedules) the drafts to Twitter, LinkedIn, Instagram, and beyond.

This repository tracks the system in incremental PRs. PR 1 (this commit) lays the foundation: project layout, Docker stack, Prisma schema, and a health-checked Express bootstrap. No business logic yet.

For the full system design, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Tech stack

- Node.js 18+ / Express
- PostgreSQL 16 (via Prisma ORM)
- Redis 7 (sessions + queue, used in later PRs)
- Docker / docker-compose

---

## Project layout

```
src/
  config/         env loading, Prisma client
  controllers/    HTTP controllers (added in feature PRs)
  services/       business logic (added in feature PRs)
  routes/         route definitions
  middlewares/    cross-cutting middleware
  utils/          shared helpers
  db/             raw DB helpers (when needed)
  modules/        feature modules
  app.js          Express app construction
  server.js       process entrypoint, graceful shutdown

prisma/
  schema.prisma   single source of truth for the DB
  seed.js         idempotent dev seed

docker/
  Dockerfile      multi-stage production image
docker-compose.yml
.env.example
```

---

## Getting started

### 1. Configure environment

```bash
cp .env.example .env
```

Adjust values as needed. The defaults work out of the box with the bundled docker-compose stack.

### 2. Run the full stack

```bash
docker-compose up --build
```

This boots PostgreSQL, Redis, and the API. The app container waits for Postgres to pass its health check, applies pending migrations (`prisma migrate deploy`), and then starts the server.

The API will be available at http://localhost:3000.

```bash
curl http://localhost:3000/health
# { "status": "ok", "uptime": 1.23, "timestamp": "...", "checks": { "database": "ok" } }
```

### 3. Seed sample data (optional)

```bash
docker-compose exec app npm run db:seed
```

Creates a demo user (`demo@postly.dev`), one connected social account, and two sample posts. Safe to run repeatedly.

---

## Local development without Docker

You'll need a local Postgres and Redis instance. Update `DATABASE_URL` and `REDIS_URL` in `.env` to point at them, then:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate    # creates the dev database schema
npm run db:seed           # optional
npm run dev               # nodemon-watched server
```

---

## Useful scripts

| Command                  | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `npm run dev`            | Start the API with nodemon                        |
| `npm start`              | Start the API in production mode                  |
| `npm run prisma:migrate` | Create and apply a new migration (development)    |
| `npm run prisma:deploy`  | Apply existing migrations (production / CI)       |
| `npm run prisma:studio`  | Open Prisma Studio against the dev DB             |
| `npm run db:seed`        | Run the seed script                               |
| `npm run db:reset`       | Drop and recreate the dev DB, then re-seed        |

---

## Environment variables

All variables and their purpose are documented in [`.env.example`](.env.example). Required values: `DATABASE_URL` and `JWT_SECRET`. Everything else is optional or has a sensible default.
