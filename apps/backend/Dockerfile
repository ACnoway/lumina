# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@8

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

RUN npm install -g pnpm@8

COPY --from=builder /app ./

# Regenerate Prisma Client in production stage (ensures correct platform binary)
RUN pnpm --filter backend prisma:generate

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "apps/backend/dist/main.js"]
