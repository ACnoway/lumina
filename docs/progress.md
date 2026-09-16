# Lumina 开发进度

> 以当前源码和可复现验证为准。这里将“代码已实现”和“在完整外部服务环境中已验证”分开记录，避免把页面、接口或模块存在误写成可直接交付。

## 当前状态基准（2026-09-16）

### 本次核对结果

- 已完整核对 `apps/backend`、`apps/frontend`、共享类型、Prisma schema、Docker Compose 和现有文档。
- 使用现有本地依赖直接运行后端 Jest：**12 个测试套件、35 个测试全部通过**（认证验证码投递、管理员账户初始化、钱包并发/幂等与管理员调额审计、Provider RBAC/审计脱敏、管理员模型可见性、管理端 RBAC、审计日志、MinIO 和生图队列）。
- 共享类型编译、Nest 后端构建、Next 前端生产构建均通过；前端已生成 `/login`、`/chat`、`/image`、`/history` 和 `/admin` 路由。
- 本机未启动前端、后端、PostgreSQL、Redis、MinIO 或 SMTP；认证验证码现已通过 mock SMTP 单元测试，但仍未执行真实认证、聊天、生图的端到端验证。
- 根脚本固定 `pnpm@8.15.0`，当前环境为 pnpm 11。直接执行 `pnpm lint`、`pnpm test`、`pnpm build` 会在依赖目录检查阶段中止，尚未进入相应任务。当前 `lint` 脚本还携带 `--fix`，不应把它当作纯只读检查执行。

### 实际完成度

| 范围 | 当前状态 | 证据与限制 |
| --- | --- | --- |
| 项目脚手架、Docker Compose、Prisma schema | 已实现 | 可构建；本机未启动容器和数据库迁移。 |
| 邮箱验证码登录、JWT、用户初始化钱包 | 代码与 mock SMTP 单元测试已验证 | 验证码仅在投递成功后写入 Redis；失败会清理验证码和 60 秒冷却状态；真实 SMTP 与数据库/Redis 联调仍待补。 |
| 钱包与账本 | 代码与单元测试已验证 | 预扣、结算、退回和 RBAC 相关安全改动有单元测试；未接真实 PostgreSQL/Redis 联调。 |
| Provider、模型路由、限流/熔断 | 代码与 RBAC 单元测试已验证 | 未配置真实供应商和模型数据，无法验证路由与上游调用。 |
| 聊天后端与前端 | 代码已实现、构建通过 | 聊天 UI、SSE 解析、会话 CRUD 调用均存在；没有聊天 API/流式/计费端到端测试。 |
| 生图后端与前端 | 代码与单元测试已验证 | 前端已接入模型、优化、创建任务、轮询和历史；后端已使用 Redis 持久化队列、重试与启动恢复。未接 MinIO/供应商或真实 Redis 做端到端验证。 |
| 历史记录独立页 | 代码已实现、前端构建通过 | `/history` 已接入用户自己的聊天会话与生图历史，支持各自分页、加载、空状态和错误重试；未接本地后端/数据库做端到端验证。 |
| 管理后台与审计 | 代码、单元测试和前端构建已验证 | `/admin` 已接入概览、用户/账本/余额调整、模型/供应商/上游映射、审计日志；服务启动会按 `ADMIN_EMAIL` 幂等创建或修复管理员账户，真实数据仍需在 PostgreSQL、Redis 和 SMTP 环境做端到端验证。 |
| CI | 已配置，当前提交未在本机按 CI 工具链复跑 | 工作流固定 Node 20 / pnpm 8.15.0；需要在干净环境或 GitHub Actions 上确认当前提交。 |

### 当前交付阻塞项

1. **运行环境未就绪**：需要 PostgreSQL、Redis、MinIO、有效 `JWT_SECRET`、SMTP 及至少一个可用 AI Provider/模型后，才能做端到端验收。
2. **验证覆盖不足**：认证、聊天流式、图片生成、管理端权限边界和前端关键流程仍缺少 API/E2E 测试。
3. **工具链不一致**：本地需使用 pnpm 8.15.0（与 CI 一致），再运行根级 `pnpm lint/test/build`；lint 脚本应先拆分出不带 `--fix` 的检查命令。

### 后续待办

- [ ] 将管理后台的平台模型配置从 JSON 文本改为按模型类型展示的结构化表单，至少覆盖聊天模型的 input/output 价格和生图模型的 perImage 价格，并补充前后端校验。

## 第一轮 P0 安全与计费修复 ✓

- Provider、Platform Model、Upstream Model 的管理查询与 mutation API 已增加 `ADMIN` / `SUPER_ADMIN` RBAC；普通 `USER` 无法修改配置，也无法读取包含 Provider 配置的管理查询结果。
- Wallet 预扣已使用用户级 Redis 分布式锁，并通过带 TTL 的预扣索引统计同一用户的全部活动 reservation；预扣记录和索引使用 Redis transaction 原子写入/删除。
- Wallet 结算已将幂等检查放入锁内，并使用数据库条件扣减作为余额非负和并发更新的最终保护；充值、管理员调整也纳入同一用户锁。
- 新增 RBAC 测试与 Wallet 并发/幂等测试：100 个相同 key 并发、100 个不同 key 并发、并发 settle、refund retry。
- 历史远程验证曾通过；本次当前源码复核中，直接运行的后端单元测试为 12 suites / 35 tests，后端和前端构建通过。根级 pnpm 验证仍受本地 pnpm 版本不匹配阻塞。
- 同步修复 Turbo 2.x 的 `pipeline` 配置兼容性，以及 frontend/backend 的非交互 lint 配置。

## CI ✓

- 新增 `.github/workflows/ci.yml`，固定 pnpm `8.15.0` 和 Node.js `20`。
- clean checkout 后依次执行依赖安装、Prisma Client 生成、`pnpm lint`、`pnpm test`、`pnpm build`。
- 当前测试只包含不依赖 PostgreSQL、Redis、MinIO 或真实 AI API 的单元测试，因此 workflow 暂不启动外部服务。
- 上述命令链已在 `lch:/root/lumina` 验证通过；GitHub Actions 首次运行结果待平台触发后确认。

## 步骤 6：生图前端页面 ✓

- commits: `d7bf2ea`, `851d9d6`, `971bf78`
- 新增 `image-api.ts`，接入模型列表、提示词优化、生图任务创建、任务查询和历史记录 API。
- 生图页已支持模型选择、比例选择、负面提示词、提示词优化、提交生成、任务轮询、刷新恢复和历史记录选择。
- 生图结果使用后端返回的动态签名 MinIO URL 直接展示，并提供失败、余额不足、上游不可用等用户可理解的错误提示。
- `ApiError` 统一保留 HTTP 状态码并展开后端校验错误，便于前端按错误类型反馈。
- 历史远程验证在当时的代码版本中通过；本次当前源码的前端生产构建已再次通过并包含 `/image` 路由，真实 Provider、MinIO 和 AI 上游仍未做端到端验证。
- 当前未执行真实 Provider、MinIO 和 AI 上游的端到端生图验证，需在具备对应外部服务配置后补充。

## 步骤 7：历史记录独立页面 ✓

- `/history` 已从静态占位替换为真实数据页面，并并行调用会话列表与生图历史接口。
- 聊天会话与生图记录分别独立分页；页面包含加载骨架、空状态、错误提示和重试操作。
- 生图记录展示提示词、模型、状态、创建时间、费用、失败原因，以及成功任务的签名图片 URL。
- 点击聊天会话会打开 `/chat?session=<id>`；聊天页会读取该参数并加载对应会话，随后不影响用户在侧栏的继续切换。
- 本次已通过前端 ESLint 与 Next.js 生产构建；由于本机没有运行认证、后端和数据库，未进行真实用户数据的端到端验证。

## 步骤 8：生图持久化队列 ✓

- `POST /image/generate` 现在先创建 `PENDING` 数据库任务、记录当前模型价格快照和重试次数，再写入 Redis 待处理列表并立即返回任务 ID。
- worker 通过 Redis 原子领取将任务移入处理中列表；数据库条件更新只允许 `PENDING → PROCESSING` 一次，因此重复队列消息或并发 worker 不会重复调用上游或计费。
- 失败时最多尝试 3 次；每次重试先退回预扣，再使用相同 `image:<taskId>` 幂等键重新进入计费链路。已结算任务绝不重新入队。
- 启动时会重入所有 `PENDING` 任务，并将超过 15 分钟未更新的 `PROCESSING` 任务按同一重试策略恢复。
- 新增队列及生图服务单元测试，验证入队、原子领取/确认、重复领取拦截和失败重试；后端全部 5 个测试套件、16 个测试及生产构建通过。
- 本机没有运行 Redis、PostgreSQL、MinIO 或真实上游，因此尚未完成跨进程重启和真实 Provider 的端到端验证。

## 步骤 9-1：管理端后端与审计 ✓

- 新增 `AdminModule`：管理员（`ADMIN` / `SUPER_ADMIN`）可查询运行概览、用户分页/搜索/状态筛选、用户详情与账本，并可更新用户状态、调整余额。
- 管理员状态修改和余额调整与其审计记录在同一 Prisma transaction 中提交；余额调整继续复用钱包用户级锁与“余额不得为负”的保护。
- 新增审计日志写入、分页与按 actor/action/resource 筛选，API 为 `GET /admin/audit-logs`；日志包含操作者、动作、资源、目标 ID、变更元数据、IP、User-Agent 和时间。
- 既有 Provider、Platform Model 与 Upstream Model 的新增、更新和删除都会写入同一审计日志，且不会把 Provider 的 API Key/config 写进审计详情。
- 共享包已补充管理端和审计接口类型；后端 Jest 9 suites / 25 tests、共享类型编译与 Nest 生产构建通过。
- 本机没有 PostgreSQL/Redis 环境，未做真实管理员 API 的端到端验证。

## 步骤 9-2：管理端前端 ✓

- `/admin` 已从占位页替换为真实管理工作台：客户端先读取当前用户角色，普通用户显示无权限状态，所有实际数据请求仍由后端 RBAC 保护。
- 概览页展示用户、钱包余额、平台模型和供应商计数；用户页支持分页、搜索、状态更新、账本查看和填写原因的余额调整。
- 配置页可查看全量（含停用）平台模型、供应商和指定模型的上游映射；支持新建配置，以及模型/供应商/上游映射的启停。Provider 的 JSON 配置仅在管理员请求中显示。
- 审计页支持按操作者、动作、资源筛选，并展示时间、请求上下文和变更元数据。
- 新增 `admin-api.ts` 前端 API 封装；Next.js 生产构建通过。Provider 服务新增“管理员可包含停用模型”的最小兼容路径并补充单测。
- 本机没有 PostgreSQL、Redis 或 Provider 配置，因此尚未验证浏览器中的真实数据流和 mutation；管理员自动初始化已有单元测试，真实数据库记录需远程确认。

### 管理员账户自动初始化 ✓

- 服务启动时读取 `ADMIN_EMAIL`，不存在时自动创建 `ADMIN` 账户并初始化钱包；`ADMIN_PASSWORD` 以 bcrypt 哈希保存。
- 如果配置邮箱已存在但仍是普通用户，启动时会将其角色修复为 `ADMIN`；已有管理员角色不会被降级。
- Docker Compose 已将 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 传递给 backend；新增 3 个初始化单元测试。

## 开发顺序总览

1. ~~项目脚手架~~ ✓
2. 用户模块 + 邮箱验证码登录（代码已实现；真实 SMTP 端到端未验证）
   - ~~2-1 认证验证码投递可靠性（A-001）~~ ✓（mock SMTP 与单元测试已验证；真实 SMTP 端到端待补）
3. ~~钱包/账本模块（预扣-结算-退回 + 幂等键）~~ ✓
4. ~~平台模型 + 上游供应商模块~~ ✓
5. 聊天页面 + 聊天 API + 流式输出
   - 5-1 ~~后端会话管理 CRUD~~ ✓
   - 5-2 ~~上游调用适配器（OpenAI/Anthropic 双格式 + SSE 流式）~~ ✓
   - 5-3 ~~消息发送 + 流式 SSE + 钱包/供应商联调~~ ✓
   - 5-4 ~~前端聊天页 UI~~（代码已完成；真实后端/上游联调待补）
6. 生图页面 + 生图任务 + 扣费联调（代码已完成；真实 Provider、MinIO 和计费端到端验证待补）
7. ~~历史记录独立页面~~ ✓（代码已完成；真实后端端到端验证待补）
8. ~~生图持久化队列~~ ✓（代码与单元测试已完成；真实 Redis/重启验证待补）
9. ~~管理端后端 + 审计 + UI~~ ✓（真实环境端到端验证待补）
10. 验证清单逐条验证

## 已完成步骤详情

### 步骤 1：项目脚手架 ✓

- commit: `8839d6b`
- NestJS 后端 + Next.js 前端 + Prisma + PostgreSQL + Redis + MinIO
- Turborepo + pnpm workspace
- Docker Compose 全容器化部署
- 共享类型包 `@lumina/shared`

### 步骤 2：用户模块 + 邮箱验证码登录（代码已实现，真实 SMTP 联调待补）

- commit: `62134d5`
- 邮箱验证码登录（Redis 存验证码，5分钟 TTL）
- JWT 认证（7天过期）
- 注册自动创建钱包并赋予初始额度（默认 10.00 元）
- 前端登录页（邮箱 + 验证码 + 60秒倒计时）
- middleware 路由保护（/chat, /image, /history, /admin）
- **当前状态**：前端和认证接口均已实现并通过构建；真实 SMTP、PostgreSQL 和 Redis 联调待补。

### 步骤 2-1：认证验证码投递可靠性（A-001）✓

- 验证码投递前使用独立 Redis 冷却 key 原子限频，60 秒内并发或重复请求不会重复发信。
- 仅在 SMTP 投递成功后写入 5 分钟验证码；投递或保存失败会清理验证码和冷却状态，失败后可立即重试。
- 发送和登录统一 trim/lowercase 邮箱；限频错误按 Redis TTL 准确提示剩余秒数。
- 新增 mock SMTP 单元测试，覆盖成功投递、失败清理、失败重试、并发限频、验证码一次性使用和错误登录失效。
- 当前认证测试为 6 tests；真实 SMTP 与 API/E2E 旅程仍需远程环境验收。

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

### 步骤 5-1：后端会话管理 CRUD（代码已实现）

- commit: `76d05a1`
- ChatService: 创建/列表/详情/更新标题/删除会话 + 历史消息分页查询
- 所有操作验证会话所有权，防越权访问
- ChatController: 6 个接口，JwtAuthGuard 保护
- DTO: CreateSessionDto, UpdateSessionDto, 分页查询 DTO

### 步骤 5-2：上游调用适配器（代码已实现）

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

### 步骤 5-3：消息发送 + 流式 SSE + 钱包/供应商联调（代码已实现，外部联调未验证）

- commit: `ee6a5c4`
- `POST /chat/messages`: SSE 流式端点，完整计费链路
- 流程: 验证会话 → 保存用户消息 → 自动标题 → 获取模型定价 → 拉上下文20条 → 预估成本预扣 → resolveUpstream路由 → 适配器流式调用 → 逐chunk推SSE → 实际token结算 → 保存AI回复
- 钱包联调: 预扣→结算(成功)/退回(失败)，幂等键 `chat:{sessionId}:{messageId}`
- 上游联调: resolveUpstream + recordResult 影响熔断器
- 错误处理: 路由失败退回预扣, 流式失败退回+记录+保存错误消息
- SSE 事件: `{type:'content',content}` → `{type:'done',usage,cost}` 或 `{type:'error',message}`
- 修复: TS never 类型断言, error:unknown 类型守卫, 新增 express 运行时依赖

### 步骤 5-4：前端聊天页 UI（代码已完成，外部联调未验证）

- 实际实现位于 `apps/frontend/src/app/chat/`：会话侧栏、消息列表、输入框、模型选择、余额展示、SSE 流式解析与 AbortController 取消逻辑均已接入。
- `apps/frontend/src/lib/chat-api.ts` 已封装会话、消息、模型、余额与流式消息 API。
- 当前没有聊天 API、流式响应、真实 Provider 或计费的端到端测试；因此不能标记为用户流程已验收。

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
│   │   │       ├── auth/                  # 邮箱验证码登录 + JWT（SMTP 配置后才可用）
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
│   │   │       ├── image/                 # 生图任务 + 提示词优化 + 扣费
│   │   │       ├── admin/                 # 用户、钱包与运行概览管理 API
│   │   │       └── audit/                 # 管理员操作审计写入与查询 API
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
│       │       ├── chat/                  # 已接入会话、SSE、模型和余额的聊天页
│       │       ├── image/page.tsx         # 已接入生图 API 的页面，外部服务待验证
│       │       ├── history/page.tsx       # 聊天会话与生图历史，已接入真实 API
│       │       └── admin/page.tsx         # 管理员工作台：用户、配置、审计
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

### Image
- `POST /image/optimize-prompt` — 优化生图提示词
- `POST /image/generate` — 创建生图任务
- `GET /image/tasks/:id` — 查询生图任务状态
- `GET /image/history?page=1&limit=12` — 生图历史记录
- `GET /providers/models?type=IMAGE` — 获取可用生图模型

### Admin（ADMIN / SUPER_ADMIN）

- `GET /admin/overview` — 运行概览
- `GET /admin/users?page=1&limit=20&search=&status=` — 用户分页、搜索与状态筛选
- `GET /admin/users/:id` — 用户详情
- `GET /admin/users/:id/transactions?page=1&limit=20` — 用户账本
- `PATCH /admin/users/:id/status` — 更新用户状态
- `POST /admin/wallet/adjustments` — 调整用户余额
- `GET /admin/audit-logs?page=1&limit=20&userId=&action=&resource=` — 审计日志

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
