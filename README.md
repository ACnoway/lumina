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
├── docker-compose.yml    # PostgreSQL + Redis + MinIO
├── turbo.json            # Turborepo 任务编排
├── pnpm-workspace.yaml   # pnpm workspace
└── .env.example          # 环境变量模板
```

## 技术栈

- **后端**：NestJS + TypeScript + Prisma + PostgreSQL + Redis + MinIO
- **前端**：Next.js (App Router) + TypeScript + Tailwind CSS
- **管理端**：前端 `/admin` 路由，权限隔离
- **包管理**：pnpm + Turborepo

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动基础设施

```bash
cp .env.example .env
docker-compose up -d
```

启动后各服务地址：
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO Console: `http://localhost:9001`

### 3. 初始化数据库

```bash
pnpm --filter backend prisma:generate
pnpm --filter backend prisma:migrate
```

### 4. 启动开发服务

```bash
# 同时启动前后端
pnpm dev

# 或分别启动
pnpm backend:dev    # 后端 http://localhost:3001
pnpm frontend:dev   # 前端 http://localhost:3000
```

### 5. 访问

| 地址 | 说明 |
|------|------|
| http://localhost:3000 | 前端首页 |
| http://localhost:3000/chat | 聊天页 |
| http://localhost:3000/image | 生图页 |
| http://localhost:3000/admin | 管理后台 |
| http://localhost:3001/api/docs | Swagger API 文档 |
| http://localhost:3001/health | 后端健康检查 |

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
    ├── admin/             # 管理端接口
    └── audit/             # 审计日志
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
pnpm dev              # 启动所有开发服务
pnpm build            # 构建所有包
pnpm lint             # 代码检查
pnpm test             # 运行测试
pnpm docker:up        # 启动基础设施容器
pnpm docker:down      # 停止基础设施容器
pnpm docker:logs      # 查看容器日志

# 后端专属
pnpm --filter backend prisma:studio    # Prisma 数据库可视化管理
pnpm --filter backend prisma:migrate   # 运行数据库迁移
```

## 开发顺序

1. ~~项目脚手架~~ ✓
2. 用户模块 + 邮箱验证码登录
3. 钱包/账本模块（预扣-结算-退回 + 幂等键）
4. 平台模型 + 上游供应商模块
5. 聊天页面 + 聊天 API + 流式输出
6. 生图页面 + 生图任务 + 扣费联调
7. 历史记录
8. 管理端 UI
9. 验证清单逐条验证
