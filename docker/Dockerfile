# ─── Stage 1 — install dependencies ──────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Prisma's schema engine binary needs OpenSSL + glibc shim on Alpine.
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* ./
# `prisma` CLI lives in dependencies (needed for `migrate deploy` at runtime),
# so --omit=dev keeps the image lean without losing migration tooling.
RUN npm ci --omit=dev

# ─── Stage 2 — runtime image ─────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Tini gives clean PID 1 signal handling so SIGTERM reaches Node.
# openssl + libc6-compat are required by Prisma's engine binary at runtime.
RUN apk add --no-cache tini openssl libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY src ./src

# Generate the Prisma client against the bundled schema
RUN npx prisma generate

# Run as a non-root user
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]

# Apply outstanding migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
