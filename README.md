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

- **后端**：NestJS + TypeScript + Prisma + PostgreSQL + Redis + S3 兼容对象存储
- **前端**：Next.js (App Router) + TypeScript + Tailwind CSS
- **管理端**：`/admin` 已接入管理员 API、RBAC、审计日志、用户/钱包、模型/供应商、支付渠道和短信渠道管理；可从已有 `CHAT` 平台模型中选择提示词优化模型；服务启动时按 `ADMIN_EMAIL` 自动初始化管理员账户
- **平台货币**：钱包、账本、模型价格和所有消费统一使用光子（符号 `✦`）；后台汇率 `1 人民币 = N 光子` 只用于充值换算，消费不套用汇率
- **包管理**：pnpm + Turborepo
- **部署**：Docker Compose 全容器化

## 快速开始

### 方式一：Docker 部署（推荐）

全部服务容器化，数据库/Redis/前后端走内网，仅通过 Nginx 暴露一个统一入口端口；生产 Compose 不再绑定本地 MinIO。

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，修改密码、JWT_SECRET、SMTP、SMS_CONFIG_ENCRYPTION_KEY 等
# 启用支付时必须配置 PAYMENT_CONFIG_ENCRYPTION_KEY 和公网 PAYMENT_NOTIFY_BASE_URL；使用短信时必须配置独立的 SMS_CONFIG_ENCRYPTION_KEY。
# 若统一入口由 Nginx 代理 /api，回调基础地址应包含 /api，例如 https://example.com/api。

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
- `/api/` 转发到后端，其他路径转发到前端；图片通过后台配置的 S3 兼容服务预签名访问
- 后端 API、PostgreSQL、Redis、前端都不单独对外暴露
- 登录 `/admin` 的“模型与供应商”配置页，在“对象存储（S3 兼容）”中填写 Endpoint、对外 Endpoint、Region、Bucket、Path-style 和密钥；保存前会验证已有 Bucket，不会自动创建
- 数据库结构由 `apps/backend/prisma/migrations/` 版本化管理；旧 `db push` 数据库若与当前 schema 有差异，backend 会拒绝启动而不会自动改表

### 提示词优化模型

登录管理后台后，进入“模型与供应商 → 提示词优化模型”，从已经配置并有可用聊天上游的 `CHAT` 平台模型中选择并保存。生图页面的“优化提示词”会通过该模型调用现有聊天适配器，并按实际 token 用量计费。

`.env` 中的 `PROMPT_OPTIMIZER_MODEL` 仅用于后台尚未保存选择时的兼容兜底；它必须对应一个已存在的平台模型，且该模型应配置可用的聊天上游。

### 支付与充值

个人中心的充值页面只需要选择支付方式并填写人民币金额，不再让普通用户选择支付场景或具体支付渠道。创建前会确认当前光子余额、本次人民币金额、支付方式、预计到账光子和充值后的预计余额；最低充值金额为 0.1 元，页面会展示当前 `1 人民币 = N 光子` 的充值汇率。

充值订单只提交人民币金额和支付方式，不提交跨渠道通用的支付场景；支付宝 PAGE/WAP/PRECREATE、微信 H5/JSAPI/Native/APP，以及易支付 `mapi.php`/`submit.php` 由各自渠道实例配置决定。Adapter 返回统一的 `REDIRECT_URL`、`HTML_FORM` 或 `QR_CODE` 等支付动作；前端会在用户点击事件内先打开空白新标签页，再请求创建订单。`REDIRECT_URL` 只会跳转到无嵌入凭据的绝对 HTTPS 地址，`HTML_FORM` 会被惰性解析为一个 HTTPS `GET`/`POST` 表单的隐藏字段后，由 DOM 重建提交，不会直接执行渠道返回的原始 HTML。创建失败会关闭该标签页，个人中心页面始终保留。

充值汇率可通过登录用户接口 `GET /payments/recharge-settings` 读取；管理员仍通过
`GET/PATCH /admin/settings/currency` 配置汇率。

个人中心通过 `GET /payments/orders` 查询当前用户的待支付充值订单（默认包含 `CREATED` 和 `PENDING`，可按状态和时间排序）；查询会排除终态订单，并将已过期的 `CREATED/PENDING` 订单标记为 `EXPIRED`，不再提供支付入口。账单顶部单独展示待支付订单及其金额、预计到账光子、渠道、订单号和有效期；它们不是 `WalletTransaction`，不会伪装成余额流水。`POST /payments/orders/:orderNo/pay` 仅会恢复原有且未过期的 `CREATED/PENDING` 订单，复用订单号、金额、光子金额和汇率快照，不会创建第二笔业务订单。

个人中心“账单”仍通过 `GET /wallet/transactions` 获取实际余额流水，并按需调用
`GET /wallet/transactions/:id` 查看详情。聊天消费详情包含输入/输出 token 和模型，生图消费详情包含模型与图片张数；充值详情包含实付人民币、订单创建时汇率、实际到账光子、Lumina 订单号和支付平台订单号。历史流水会通过已有支付订单和生图任务数据兼容补齐详情。

支付订单创建只会进入 `CREATED/PENDING`，余额仅在渠道验签成功的异步通知或服务端明确确认已付款的查单后入账。成功后统一生成一条 `RECHARGE` 流水并更新余额；通知去重键包含状态，因此同一平台单号从 `PENDING` 到 `SUCCESS` 时不会漏掉成功入账，而相同状态的重复通知仍由既有幂等键保护。`return_url`、前端新标签页、轮询和“去支付”都不能直接改变余额，失败、关闭或过期订单也不能恢复入账。

生产环境必须显式设置 `PAYMENT_NOTIFY_BASE_URL`，并确保最终的
`/payments/notify/:channelId` 能通过公网入口到达后端；支付渠道配置使用
`PAYMENT_CONFIG_ENCRYPTION_KEY` 加密保存，密钥变更前必须完成配置迁移。易支付 `baseUrl`、支付宝 `gateway` 与微信 `baseUrl` 必须是无嵌入凭据、查询串和片段的 HTTPS endpoint；易支付查单携带商户 key，禁止配置 HTTP 地址。
Docker 生产编排会设置 `TRUST_PROXY=true`，使微信 H5 下单可取得 Nginx 传递的真实客户端 IP；仅当后端只经受信任的反向代理暴露时才应启用该配置。

### 手机号与短信认证

认证接口兼容原有邮箱参数，同时支持 `account`（邮箱或手机号）参数：

- `POST /auth/send-code`、`POST /auth/register/send-code`：根据邮箱或手机号发送登录/注册验证码；邮箱路径继续使用 SMTP，手机号路径使用已启用的短信渠道。
- `POST /auth/password-login`：`account + password`，账号可为邮箱或手机号。
- `POST /auth/login`：`account + code`，账号为邮箱时校验邮箱验证码，账号为手机号时校验短信验证码。
- `POST /auth/phone/send-code`、`PATCH /auth/me/phone`：登录用户绑定或更换手机号。

手机号注册用户可以不填写邮箱；邮箱注册用户可以在个人中心绑定手机号。邮箱和手机号在数据库中均为可选唯一字段，但业务层保证至少有一个，短信登录只允许已验证手机号。`/auth/me`、`/users/me` 和管理端用户接口只返回脱敏手机号（例如 `138****1234`），不会返回短信渠道密钥或验证码。

短信渠道位于 `apps/backend/src/modules/sms/`，包含 `MockSmsAdapter`、`AliyunSmsAdapter` 和 `TencentSmsAdapter`。管理端“短信渠道”页提供 Adapter 能力、渠道 CRUD、启停和配置测试；配置采用独立的 `SMS_CONFIG_ENCRYPTION_KEY` 加密，列表只返回脱敏摘要。Mock 渠道会把最近验证码短暂写入 Redis 的 `sms:mock:last-code:*`，仅用于测试，不写入数据库。

老用户迁移由 `20261009000000_add_phone_sms_auth` 完成：原有邮箱值保留，`email` 改为可空并新增可空唯一 `phone` 与 `phoneVerifiedAt`，管理员邮箱初始化逻辑不变。部署时先执行 `prisma migrate deploy`，再启动应用。

### 方式二：本地开发

```bash
# 1. 启动基础设施（PostgreSQL + Redis + 本地 MinIO S3 测试服务，暴露端口）
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
              └─ /health        ──→ [backend:3001]

[backend:3001] ──→ [postgres:5432]
                  [redis:6379]
                  [S3 兼容对象存储]
```

- `lumina-network` 内部网络
- Docker 部署由 Nginx 将统一域名分发到前端和后端；对象存储由管理员配置，预签名 URL 直接指向其对外 Endpoint
- 本地开发和 E2E 仍使用 MinIO 作为 S3 兼容测试服务；E2E smoke 会在 fixture 阶段预先创建 Bucket，本地开发需自行创建

## 后端模块结构

```
apps/backend/src/
├── main.ts               # 入口，Swagger + CORS + 验证管道
├── app.module.ts          # 根模块
├── app.controller.ts      # 健康检查
├── prisma/                # Prisma 数据库连接
├── redis/                 # Redis 连接
├── object-storage/        # S3 兼容对象存储客户端与热刷新
└── modules/
    ├── auth/              # 邮箱/手机号注册、密码/验证码登录、JWT
    ├── users/             # 用户管理
    ├── sms/               # 短信渠道协议、Adapter、配置和 Mock 渠道
    ├── wallet/            # 钱包/账本（预扣-结算-退回 + 幂等键）
    ├── payments/          # 支付渠道、订单、回调与充值入账
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
├── profile/               # 个人中心（充值、钱包和账单）
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

# API/E2E 冒烟（需要 Docker；使用独立命名卷，不复用开发数据；Mock SMS 不调用真实供应商）
pnpm e2e:up
pnpm e2e:smoke
pnpm e2e:down
```

## 开发顺序

1. ~~项目脚手架~~ ✓
2. 用户模块 + 邮箱/手机号验证码登录（邮箱保留兼容；短信 E2E 使用 MockSmsAdapter）
3. 钱包/账本模块（预扣-结算-退回 + 幂等键）
4. 平台模型 + 上游供应商模块
5. 聊天页面 + 聊天 API + 流式输出
6. 生图页面 + 生图任务 + 扣费联调
7. ~~历史记录独立页面~~ ✓（真实后端端到端验证待补）
8. ~~生图持久化队列~~ ✓（真实 Redis/重启验证待补）
9. ~~管理端后端 + 审计 + UI~~ ✓（真实环境端到端验证待补）
10. 验证清单逐条验证
