# Lumina - AI 聊天生图平台

> V1：用户端开箱即用的 AI 聊天 + AI 生图，管理端做稳做对。

## 项目结构

```
lumina/
├── apps/
│   ├── backend/          # NestJS 后端 API（端口 3001）
│   └── frontend/         # Next.js 前端（端口 3000）
├── packages/
│   └── shared/           # 共享类型、常量、DTO
├── nginx/
│   └── Dockerfile        # 内嵌单域名入口路由的 Nginx 镜像
├── docker-compose.yml       # Docker 部署：全部容器化，仅暴露 Nginx 入口端口
├── docker-compose.dev.yml   # 本地开发：仅基础设施，暴露所有端口
├── turbo.json            # Turborepo 任务编排
├── pnpm-workspace.yaml   # pnpm workspace
└── .env.example          # 环境变量模板
```

## 技术栈

- **后端**：NestJS + TypeScript + Prisma + PostgreSQL + Redis + MinIO
- **前端**：Next.js (App Router) + TypeScript + Tailwind CSS
- **管理端**：`/admin` 已接入管理员 API、RBAC、审计日志、用户/钱包与模型/供应商管理；可从已有 `CHAT` 平台模型中选择提示词优化模型；服务启动时按 `ADMIN_EMAIL` 自动初始化管理员账户
- **平台货币**：钱包、账本、模型价格和所有消费统一使用光子（符号 `✦`）；后台汇率 `1 人民币 = N 光子` 只用于充值换算，消费不套用汇率
- **包管理**：pnpm + Turborepo
- **部署**：Docker Compose 全容器化

## 快速开始

### 方式一：Docker 部署（推荐）

全部服务容器化，数据库/Redis/MinIO/前后端走内网，仅通过 Nginx 暴露一个统一入口端口。

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，修改密码、JWT_SECRET、SMTP 等

# 2. 构建并启动所有服务
pnpm docker:up
# 或
docker-compose up -d --build

# 3. 数据库迁移
# backend 启动时自动执行版本化迁移（prisma migrate deploy）
# 首次部署会执行 baseline；旧版 db push 初始化且 schema 同构的数据库会自动标记 baseline
# 如需查看状态：
docker exec -w /app/apps/backend lumina-backend pnpm exec prisma migrate status

# 4. 访问
# 前端: http://localhost:3000
# Swagger: http://localhost:3000/api/docs (通过前端代理)
```

**端口暴露说明：**
- 默认只暴露 Nginx 的 `3000` 端口
- `/api/` 转发到后端，`/lumina-images/` 转发到 MinIO，其他路径转发到前端
- 后端 API、PostgreSQL、Redis、MinIO、前端都不单独对外暴露
- Docker Compose 本地部署可使用默认的 `http://localhost:3000`；使用自有域名时将 `MINIO_PUBLIC_URL` 填为该统一入口，例如 `https://example.com`
- 数据库结构由 `apps/backend/prisma/migrations/` 版本化管理；旧 `db push` 数据库若与当前 schema 有差异，backend 会拒绝启动而不会自动改表

### 提示词优化模型

登录管理后台后，进入“模型与供应商 → 提示词优化模型”，从已经配置并有可用聊天上游的 `CHAT` 平台模型中选择并保存。生图页面的“优化提示词”会通过该模型调用现有聊天适配器，并按实际 token 用量计费。

`.env` 中的 `PROMPT_OPTIMIZER_MODEL` 仅用于后台尚未保存选择时的兼容兜底；它必须对应一个已存在的平台模型，且该模型应配置可用的聊天上游。

### 方式二：本地开发

```bash
# 1. 启动基础设施（PostgreSQL + Redis + MinIO，暴露端口）
pnpm docker:dev

# 2. 安装依赖
pnpm install

# 3. 生成 Prisma Client
pnpm --filter @lumina/shared build
pnpm --filter backend prisma:generate

# 4. 运行数据库迁移
pnpm --filter backend prisma:migrate

# 5. 启动前后端开发服务
pnpm dev
# 或分别启动
pnpm backend:dev    # 后端 http://localhost:3001
pnpm frontend:dev   # 前端 http://localhost:3000
```

## 服务地址

| 地址 | 说明 |
|------|------|
| http://localhost:3000 | 前端首页 |
| http://localhost:3000/chat | 聊天页 |
| http://localhost:3000/image | 生图页 |
| http://localhost:3000/admin | 管理后台 |
| http://localhost:3000/api/docs | Swagger API 文档（前端代理） |
| http://localhost:3000/health | 后端健康检查（前端代理） |

## Docker 网络架构

```
外部访问 ──→ [nginx:80]
              ├─ /              ──→ [frontend:3000]
              ├─ /api/*         ──→ [backend:3001]
              ├─ /lumina-images ──→ [minio:9000]
              └─ /health        ──→ [backend:3001]

[backend:3001] ──→ [postgres:5432]
                  [redis:6379]
                  [minio:9000]
```

- `lumina-network` 内部网络
- Docker 部署由 Nginx 按路径将统一域名分发到前端、后端和 MinIO；本地开发仍可使用 Next.js rewrites
- 后端通过内网连接 PostgreSQL、Redis、MinIO

## 后端模块结构

```
apps/backend/src/
├── main.ts               # 入口，Swagger + CORS + 验证管道
├── app.module.ts          # 根模块
├── app.controller.ts      # 健康检查
├── prisma/                # Prisma 数据库连接
├── redis/                 # Redis 连接
├── minio/                 # MinIO 对象存储
└── modules/
    ├── auth/              # 注册、密码/邮箱验证码登录、JWT
    ├── users/             # 用户管理
    ├── wallet/            # 钱包/账本（预扣-结算-退回 + 幂等键）
    ├── providers/         # 上游供应商（路由/熔断/限流）
    ├── chat/              # 聊天会话、流式输出
    ├── image/             # 生图任务、异步处理
    ├── admin/             # 用户、钱包与运行概览管理 API
    └── audit/             # 管理员操作审计写入与查询 API
```

## 前端页面结构

```
apps/frontend/src/app/
├── layout.tsx             # 根布局
├── page.tsx               # 公开首页（展示 AI 生图与 AI 聊天入口）
├── login/                 # 登录页
├── register/              # 注册页
├── chat/                  # 聊天页
├── image/                 # 生图页
├── history/               # 历史记录
└── admin/                 # 管理后台
```

## 常用命令

```bash
# Docker 部署
pnpm docker:up              # 构建并启动全部容器
pnpm docker:down            # 停止全部容器
pnpm docker:logs            # 查看容器日志

# 本地开发
pnpm docker:dev             # 启动基础设施容器
pnpm docker:dev:down        # 停止基础设施容器
pnpm dev                    # 启动前后端开发服务
pnpm build                  # 构建所有包
pnpm lint                   # 代码检查
pnpm lint:fix               # 显式执行 lint 自动修复

# 后端
pnpm --filter backend prisma:studio    # Prisma 数据库可视化管理
pnpm --filter backend prisma:migrate   # 运行数据库迁移

# API/E2E 冒烟（需要 Docker；使用独立命名卷，不复用开发数据）
pnpm e2e:up
pnpm e2e:smoke
pnpm e2e:down
```

## 开发顺序

1. ~~项目脚手架~~ ✓
2. 用户模块 + 邮箱验证码登录（代码已实现；需配置真实 SMTP 并完成端到端验证）
3. 钱包/账本模块（预扣-结算-退回 + 幂等键）
4. 平台模型 + 上游供应商模块
5. 聊天页面 + 聊天 API + 流式输出
6. 生图页面 + 生图任务 + 扣费联调
7. ~~历史记录独立页面~~ ✓（真实后端端到端验证待补）
8. ~~生图持久化队列~~ ✓（真实 Redis/重启验证待补）
9. ~~管理端后端 + 审计 + UI~~ ✓（真实环境端到端验证待补）
10. 验证清单逐条验证
