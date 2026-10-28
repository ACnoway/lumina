# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@8

COPY . .

# pnpm 8 may still run backend dependency scripts with a workspace filter.
# The frontend needs no install scripts; skip unrelated Prisma engine downloads.
RUN pnpm install --frozen-lockfile --filter frontend... --ignore-scripts

# Build shared package first (frontend depends on it)
RUN pnpm --filter @lumina/shared build

# BACKEND_URL is baked into Next.js routes manifest at build time
# In Docker, frontend proxies /api/* to the backend container
ARG BACKEND_URL=http://backend:3001
ENV BACKEND_URL=$BACKEND_URL

RUN pnpm --filter frontend build

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm@8

COPY --from=builder /app ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["pnpm", "--filter", "frontend", "start"]
