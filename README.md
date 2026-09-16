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
├── docker-compose.yml       # 生产部署：全部容器化，仅暴露前端端口
├── docker-compose.dev.yml   # 本地开发：仅基础设施，暴露所有端口
├── turbo.json            # Turborepo 任务编排
├── pnpm-workspace.yaml   # pnpm workspace
└── .env.example          # 环境变量模板
```

## 技术栈

- **后端**：NestJS + TypeScript + Prisma + PostgreSQL + Redis + MinIO
- **前端**：Next.js (App Router) + TypeScript + Tailwind CSS
- **管理端**：管理员后端 API、RBAC 与审计已实现；`/admin` 管理 UI 待接入
- **包管理**：pnpm + Turborepo
- **部署**：Docker Compose 全容器化

## 快速开始

### 方式一：Docker 部署（推荐）

全部服务容器化，数据库/Redis/MinIO 走内网，仅暴露前端端口。

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，修改密码、JWT_SECRET、SMTP 等

# 2. 构建并启动所有服务
pnpm docker:up
# 或
docker-compose up -d --build

# 3. 初始化数据库（首次）
docker exec lumina-backend pnpm --filter backend prisma:migrate

# 4. 访问
# 前端: http://localhost:3000
# Swagger: http://localhost:3000/api/docs (通过前端代理)
```

**端口暴露说明：**
- 默认只暴露前端 `3000` 端口
- 后端 API、PostgreSQL、Redis、MinIO 都在内部网络，不对外暴露
- 如需调试，取消 `docker-compose.yml` 中对应 `ports` 的注释

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
外部访问 ──→ [frontend:3000] ──→ [backend:3001] ──→ [postgres:5432]
                    │                    │           [redis:6379]
                    │                    └────────→ [minio:9000]
                    └─ /api/* 代理 ──────┘
```

- `lumina-network` 内部网络
- 前端通过 Next.js rewrites 将 `/api/*` 代理到 `backend:3001`
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
    ├── auth/              # 邮箱验证码登录、JWT
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
├── page.tsx               # 首页（重定向到 /chat）
├── login/                 # 登录页
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

# 后端
pnpm --filter backend prisma:studio    # Prisma 数据库可视化管理
pnpm --filter backend prisma:migrate   # 运行数据库迁移
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
9. 管理端后端 + 审计（已完成；管理端 UI 未完成）
10. 验证清单逐条验证
