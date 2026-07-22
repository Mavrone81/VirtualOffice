# Enshrine VirtualOffice — production image (Next.js standalone).
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# --- deps ---
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- build ---
FROM base AS builder
# Build-time placeholders so eager module init (Prisma client, env/crypto
# validation) never trips during `next build`. Real values are injected at
# runtime via .env; authed pages are force-dynamic so nothing DB-hits at build.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
ENV AUTH_SECRET="build-time-placeholder-not-used-at-runtime"
ENV PII_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# --- migrator (lightweight: `prisma migrate deploy` only) ---
# Just deps + the prisma schema/migrations — no `next build`, so it rebuilds
# fast (deps layer is cached; only the COPY prisma layer changes when a
# migration is added). Used by the compose `migrate` service so CI can apply
# pending migrations on every deploy. DATABASE_URL comes from .env at runtime.
FROM base AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
CMD ["pnpm", "prisma", "migrate", "deploy"]

# --- runtime (standalone) ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# Uploads root — chown so a fresh named volume mounted here inherits nextjs
# ownership (the container runs as the non-root nextjs user).
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
