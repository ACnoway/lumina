# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Prisma's Alpine engines dynamically link against OpenSSL.  Without this
# package Prisma cannot detect the available libssl version and falls back to
# an incompatible OpenSSL 1.1 engine at runtime.
RUN apk add --no-cache openssl \
  && npm install -g pnpm@8

# Copy entire workspace (respect .dockerignore)
COPY . .

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build shared package first (backend depends on it)
RUN pnpm --filter @lumina/shared build

# Generate Prisma Client
RUN pnpm --filter backend prisma:generate

# Build backend
RUN pnpm --filter backend build

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

# Keep the runtime libssl present as well: the Prisma query/schema engines are
# executed after this stage has been built.
RUN apk add --no-cache openssl \
  && npm install -g pnpm@8

COPY --from=builder /app ./

# Regenerate Prisma Client in production stage (ensures correct platform binary)
RUN pnpm --filter backend prisma:generate

ENV NODE_ENV=production

EXPOSE 3001

# 启动前先同步数据库表结构（从 schema.prisma 直接创建/更新表）
CMD ["sh", "-c", "pnpm --filter backend exec prisma db push --skip-generate && node apps/backend/dist/main.js"]
