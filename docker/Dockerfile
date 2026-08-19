# ── dev target (compose --profile app; Milestone 0.1) ────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

# ── production build (standalone output; Milestone 0.4) ──────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S n8e && adduser -S n8e -G n8e
COPY --from=build --chown=n8e:n8e /app/.next/standalone ./
COPY --from=build --chown=n8e:n8e /app/.next/static ./.next/static
COPY --from=build --chown=n8e:n8e /app/public ./public
USER n8e
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]

# ── one-shot migration image (deploy runs it before swapping app) ─────────────
FROM node:22-alpine AS migrate
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/lib/db ./src/lib/db
CMD ["pnpm", "drizzle:migrate"]
