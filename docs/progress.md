# Lumina 开发进度

> 按 README 开发顺序逐步推进，每步完成即 commit + push。

## 第一轮 P0 安全与计费修复 ✓

- Provider、Platform Model、Upstream Model 的管理查询与 mutation API 已增加 `ADMIN` / `SUPER_ADMIN` RBAC；普通 `USER` 无法修改配置，也无法读取包含 Provider 配置的管理查询结果。
- Wallet 预扣已使用用户级 Redis 分布式锁，并通过带 TTL 的预扣索引统计同一用户的全部活动 reservation；预扣记录和索引使用 Redis transaction 原子写入/删除。
- Wallet 结算已将幂等检查放入锁内，并使用数据库条件扣减作为余额非负和并发更新的最终保护；充值、管理员调整也纳入同一用户锁。
- 新增 RBAC 测试与 Wallet 并发/幂等测试：100 个相同 key 并发、100 个不同 key 并发、并发 settle、refund retry。
- 远程环境验证：`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm test`（2 suites / 7 tests）、`pnpm build` 全部通过；lint 保留仓库既有的 31 个 `any` 警告。
- 同步修复 Turbo 2.x 的 `pipeline` 配置兼容性，以及 frontend/backend 的非交互 lint 配置。

## CI ✓

- 新增 `.github/workflows/ci.yml`，固定 pnpm `8.15.0` 和 Node.js `20`。
- clean checkout 后依次执行依赖安装、Prisma Client 生成、`pnpm lint`、`pnpm test`、`pnpm build`。
- 当前测试只包含不依赖 PostgreSQL、Redis、MinIO 或真实 AI API 的单元测试，因此 workflow 暂不启动外部服务。
- 上述命令链已在 `lch:/root/lumina` 验证通过；GitHub Actions 首次运行结果待平台触发后确认。

## 开发顺序总览

1. ~~项目脚手架~~ ✓
2. ~~用户模块 + 邮箱验证码登录~~ ✓
3. ~~钱包/账本模块（预扣-结算-退回 + 幂等键）~~ ✓
4. ~~平台模型 + 上游供应商模块~~ ✓
5. 聊天页面 + 聊天 API + 流式输出
   - 5-1 ~~后端会话管理 CRUD~~ ✓
   - 5-2 ~~上游调用适配器（OpenAI/Anthropic 双格式 + SSE 流式）~~ ✓
   - 5-3 ~~消息发送 + 流式 SSE + 钱包/供应商联调~~ ✓
   - 5-4 前端聊天页 UI（待开发）
6. 生图页面 + 生图任务 + 扣费联调
7. 历史记录
8. 管理端 UI
9. 验证清单逐条验证

## 已完成步骤详情

### 步骤 1：项目脚手架 ✓

- commit: `8839d6b`
- NestJS 后端 + Next.js 前端 + Prisma + PostgreSQL + Redis + MinIO
- Turborepo + pnpm workspace
- Docker Compose 全容器化部署
- 共享类型包 `@lumina/shared`

### 步骤 2：用户模块 + 邮箱验证码登录 ✓

- commit: `62134d5`
- 邮箱验证码登录（Redis 存验证码，5分钟 TTL）
- JWT 认证（7天过期）
- 注册自动创建钱包并赋予初始额度（默认 10.00 元）
- 前端登录页（邮箱 + 验证码 + 60秒倒计时）
- middleware 路由保护（/chat, /image, /history, /admin）

### 步骤 3：钱包/账本模块 ✓

- commit: `c16dc96`
- 三阶段计费：preDeduct（Redis 预扣锁定）→ settle（Prisma 事务结算）→ refund（退回）
- 幂等键机制：idempotencyKey 防重复交易
- 交易记录分页查询
- 充值（管理员用）、管理员调整余额
- API: `GET /wallet/balance`, `GET /wallet/transactions`
- 已知技术债务记录在 `docs/known-issues.md`（W-001 并发安全非原子, W-002 竞态）

### 步骤 4：平台模型 + 上游供应商模块 ✓

- commit: `92fe985`
- Schema 新增 `PlatformModel`、`UpstreamModel` 两张表
- Provider 表扩展 `apiFormat`（openai_chat/openai_compatible/anthropic_messages/openai_image/stability_image）和 `supportsStreaming`
- 平台模型名映射多个上游，按 priority + weight 路由
- 熔断器（Redis 实现）：失败计数 + 熔断打开，TTL 自动恢复
- 限流（Redis 固定窗口）：INCR + EXPIRE 每分钟计数
- `resolveUpstream` 返回 `recordResult` 回调，调用方回报结果影响熔断器
- 管理端 API：平台模型/供应商/上游映射全套 CRUD
- RedisService 新增 `incr` 方法
- 已知限制：限流固定窗口（P-001），记录在 `docs/known-issues.md`

### 步骤 5-1：后端会话管理 CRUD ✓

- commit: `76d05a1`
- ChatService: 创建/列表/详情/更新标题/删除会话 + 历史消息分页查询
- 所有操作验证会话所有权，防越权访问
- ChatController: 6 个接口，JwtAuthGuard 保护
- DTO: CreateSessionDto, UpdateSessionDto, 分页查询 DTO

### 步骤 5-2：上游调用适配器 ✓

- commit: `470d8bc`
- `adapters/types.ts`: 统一接口 IChatAdapter, ChatRequest, ChatResponse, StreamCallbacks
- `adapters/openai.adapter.ts`: 支持 openai_chat/openai_compatible
  - 非流式: POST /chat/completions, 解析 choices[0].message + usage
  - 流式: SSE buffer 累积处理跨 chunk, stream_options.include_usage
- `adapters/anthropic.adapter.ts`: 支持 anthropic_messages
  - system 消息提取到顶层字段
  - SSE 按双换行分割事件块, 解析 message_start/content_block_delta/message_delta/message_stop
- `adapters/adapter-factory.ts`: 根据 apiFormat 创建适配器
- `adapters/adapters.module.ts`: NestJS 模块, 导出 AdapterFactory
- 错误处理: 超时/401/429/5xx 全覆盖, 中文提示

### 步骤 5-3：消息发送 + 流式 SSE + 钱包/供应商联调 ✓

- commit: `ee6a5c4`
- `POST /chat/messages`: SSE 流式端点，完整计费链路
- 流程: 验证会话 → 保存用户消息 → 自动标题 → 获取模型定价 → 拉上下文20条 → 预估成本预扣 → resolveUpstream路由 → 适配器流式调用 → 逐chunk推SSE → 实际token结算 → 保存AI回复
- 钱包联调: 预扣→结算(成功)/退回(失败)，幂等键 `chat:{sessionId}:{messageId}`
- 上游联调: resolveUpstream + recordResult 影响熔断器
- 错误处理: 路由失败退回预扣, 流式失败退回+记录+保存错误消息
- SSE 事件: `{type:'content',content}` → `{type:'done',usage,cost}` 或 `{type:'error',message}`
- 修复: TS never 类型断言, error:unknown 类型守卫, 新增 express 运行时依赖

## 当前项目文件结构

```
lumina/
├── apps/
│   ├── backend/
│   │   ├── prisma/schema.prisma          # User, Wallet, WalletTransaction,
│   │   │                                   # ChatSession, ChatMessage, ImageGeneration,
│   │   │                                   # Provider(+apiFormat,supportsStreaming),
│   │   │                                   # PlatformModel, UpstreamModel, AuditLog
│   │   ├── src/
│   │   │   ├── main.ts                    # Swagger + CORS + ValidationPipe
│   │   │   ├── app.module.ts              # 根模块
│   │   │   ├── prisma/                    # PrismaService
│   │   │   ├── redis/                     # RedisService (get/set/del/incr/ttl)
│   │   │   ├── minio/                     # MinioService
│   │   │   └── modules/
│   │   │       ├── auth/                  # 邮箱验证码登录 + JWT
│   │   │       ├── users/                 # 用户管理
│   │   │       ├── wallet/                # 钱包/账本 (三阶段计费)
│   │   │       ├── providers/             # 平台模型 + 上游路由/熔断/限流
│   │   │       ├── chat/
│   │   │       │   ├── chat.service.ts    # 会话CRUD + sendMessageStream
│   │   │       │   ├── chat.controller.ts # 会话API + POST /chat/messages (SSE)
│   │   │       │   ├── dto/chat.dto.ts    # CreateSession/UpdateSession/SendMessage/分页
│   │   │       │   └── adapters/
│   │   │       │       ├── types.ts       # IChatAdapter 接口
│   │   │       │       ├── openai.adapter.ts
│   │   │       │       ├── anthropic.adapter.ts
│   │   │       │       ├── adapter-factory.ts
│   │   │       │       └── adapters.module.ts
│   │   │       ├── image/                 # TODO
│   │   │       ├── admin/                 # TODO
│   │   │       └── audit/                 # TODO
│   │   └── package.json                   # +axios, +express
│   └── frontend/
│       ├── src/
│       │   ├── lib/
│       │   │   ├── api-client.ts          # fetch 封装 + stream() 方法
│       │   │   └── auth.ts                # JWT token 管理
│       │   ├── middleware.ts              # 路由保护
│       │   └── app/
│       │       ├── layout.tsx             # 根布局
│       │       ├── page.tsx               # 首页 → redirect /chat
│       │       ├── login/page.tsx         # 登录页（已实现）
│       │       ├── chat/page.tsx          # 聊天页（占位，待实现）
│       │       ├── image/page.tsx         # 生图页（占位）
│       │       ├── history/page.tsx       # 历史记录（占位）
│       │       └── admin/page.tsx         # 管理后台（占位）
│       ├── next.config.ts                 # rewrites /api/* → backend:3001
│       └── package.json                   # next 14, react 18, tailwind 3
├── packages/shared/src/index.ts           # 共享类型（已含全部 DTO）
├── docs/
│   ├── progress.md                        # 本文件
│   ├── known-issues.md                    # 已知技术债务
│   └── plan-5-4.md                        # 5-4 前端聊天页规划
├── docker-compose.yml                     # 生产部署
├── docker-compose.dev.yml                 # 本地开发基础设施
└── .env.example                           # 环境变量模板
```

## 后端 API 清单（已实现）

### Auth
- `POST /auth/send-code` — 发送验证码
- `POST /auth/login` — 验证码登录

### Users
- `GET /users/me` — 获取当前用户信息（含钱包余额）

### Wallet
- `GET /wallet/balance` — 获取余额
- `GET /wallet/transactions?page=1&limit=20` — 交易记录

### Providers（管理端）
- `GET/POST/PATCH/DELETE /providers` — 供应商 CRUD
- `GET/POST/PATCH/DELETE /providers/models` — 平台模型 CRUD
- `GET/POST /providers/models/:id/upstreams` — 上游映射
- `PATCH/DELETE /providers/upstreams/:id` — 上游映射改删

### Chat
- `POST /chat/sessions` — 创建会话
- `GET /chat/sessions?page=1&limit=20` — 会话列表
- `GET /chat/sessions/:id` — 会话详情
- `PATCH /chat/sessions/:id` — 更新标题
- `DELETE /chat/sessions/:id` — 删除会话
- `GET /chat/sessions/:id/messages?page=1&limit=50` — 历史消息
- `POST /chat/messages` — 发送消息（SSE 流式响应）

## SSE 事件格式

```
data: {"type":"content","content":"你好"}\n\n
data: {"type":"content","content":"世界"}\n\n
data: {"type":"done","usage":{"inputTokens":10,"outputTokens":20,"totalTokens":30},"cost":0.002}\n\n
```

错误时：
```
data: {"type":"error","message":"上游请求超时"}\n\n
```
