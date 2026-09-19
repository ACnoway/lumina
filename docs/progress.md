# Lumina 开发进度

> 以当前源码和可复现验证为准。这里将“代码已实现”和“在完整外部服务环境中已验证”分开记录，避免把页面、接口或模块存在误写成可直接交付。

## 本次模块：聊天消息 Markdown 渲染（代码已实现，远程验证待完成）

- 聊天页已为用户和 AI 的已发送消息接入 Markdown 渲染；输入框仍保持纯文本输入，不显示 Markdown 预览。
- 使用 `react-markdown`、`remark-gfm` 和 `remark-breaks`，支持常用 Markdown、GFM 表格/任务列表/删除线以及聊天场景中的单换行。
- 使用 `rehype-sanitize` 做安全清理，不启用原始 HTML 渲染；消息仍以原始 Markdown 文本保存，未修改后端接口和数据库结构。
- 流式 AI 回复沿用现有 SSE 和乐观更新逻辑，内容逐段变化时同步重新渲染；加载占位和错误消息保持原有行为。
- 主要文件：`apps/frontend/src/app/chat/components/MarkdownContent.tsx`、`MessageList.tsx`、`apps/frontend/src/app/globals.css` 和前端依赖配置。
- 当前本地无法安装新依赖：环境使用 pnpm 11，仓库锁定 pnpm 8.15.0，且 npm registry 不可访问；待推送后在 `lch:/root/lumina` 生成锁文件并完成构建、测试和 E2E 验证。

## 本次模块：生图页余额展示与首页入口卡片间距（代码已实现，远程隔离环境验证通过）

- 生图页在“创作一张新图片”标题区域展示当前光子余额，并在进入页面、提示词优化和生图任务状态结束后刷新余额。
- 首页“从这里开始”的两个入口卡片收紧内边距、标题间距和底部间距，进一步降低整体高度。
- 远程 `lch:/root/lumina` 已通过 `pnpm test`（21 个测试套件 / 92 个测试）、`pnpm build` 和隔离 `pnpm e2e:smoke`，测试资源已清理。

## 本次模块：个人中心账单功能（代码已实现，远程隔离环境验证通过）

- 复用现有 `WalletTransaction` 作为余额变化的唯一流水来源，覆盖充值、消费、退款和管理员调整，不新增账单表或 Prisma migration。
- `GET /wallet/transactions` 新增按交易类型筛选；仍按当前 JWT 用户隔离数据，并保留分页查询。
- 个人中心“消费记录”入口已改为“账单”，展示当前余额、交易类型筛选、充值/消费/退款/管理员调整记录、交易后余额、时间、原因和分页状态。
- 消费金额按负向展示并使用红色；充值和退款使用正向展示；管理员调整按实际正负显示。即使金额为 0，消费仍保留 `-`，充值仍保留 `+`。前台统一展示“消费”“充值”“退款”“管理员调整”等中文，不直接展示 `CONSUME` 等枚举值。
- 账单金额和交易后余额最多显示小数点后 4 位；超过第 4 位时直接截断，不进行四舍五入，例如 `1.23456` 显示为 `1.2345`。
- 管理后台最近账本同步使用中文交易类型和正确的消费红色显示，避免消费流水因后端金额存储为正数而错误显示为绿色。
- 新增用户账单 API 封装和 E2E 断言，覆盖用户看到管理员余额调整和服务消费流水的场景。
- 本地完整外部服务环境不可用；提交 `5dcc692` 已推送并在 `lch:/root/lumina` 通过 `pnpm test`（21 个测试套件 / 92 个测试）、`pnpm build` 和隔离 Compose `pnpm e2e:smoke`，测试资源已清理；符号修正提交 `f17399a` 和四位小数截断提交 `8501f98` 均已通过远程生产构建。

## 本次模块：个人中心分区导航重构（代码已实现，远程隔离环境验证通过）

- 个人中心从单页纵向堆叠改为桌面端左侧分组导航、移动端横向标签导航，栏目包括账户概览、充值与钱包、安全设置、消费记录和个性化设置。
- 余额和账户信息集中到“账户概览”；现有充值流程迁移到“充值与钱包”，修改密码迁移到“安全设置”，支付轮询、密码校验和错误处理逻辑保持不变。
- 当前栏目写入 `/profile?tab=...`，支持刷新、前进后退和直接访问；账单栏目已接入余额流水，个性化设置仍保留扩展入口。
- 概览余额卡新增“去充值”快捷按钮，分组导航、移动端标签和快捷操作统一补充线性图标，不引入额外 UI 依赖。
- 前端实现文件为 `apps/frontend/src/app/profile/page.tsx`；本次账单功能新增交易类型筛选参数，但未新增数据库字段。
- 本地 TypeScript 检查（`tsc --noEmit --incremental false`）和页面 ESLint 检查已通过；本机 `pnpm --filter frontend build` 受 pnpm 11 与仓库 pnpm 8 lockfile 不兼容影响未执行完成，直接 Next 构建长时间无输出后停止。
- 远程 `lch:/root/lumina` 已拉取本次提交；前端生产构建、隔离 Compose 构建和完整 `pnpm e2e:smoke` 均通过。浏览器验收覆盖登录后概览、充值与钱包、安全设置、消费记录占位、侧边栏切换和刷新后保留 `/profile?tab=...`；测试完成后已清理隔离容器、网络和卷。

## 本次模块：模块化支付渠道 V1（代码已实现，隔离环境验证通过，真实商户联调待补）

- 新增 `PaymentChannel`、`PaymentOrder`、`PaymentCallbackEvent` 及 Prisma migration。
- 新增 `PaymentsModule`、统一 Adapter Registry、AES-256-GCM 配置加密、订单幂等、回调幂等、金额校验和钱包充值入账。
- 已接入易支付 V1、支付宝官方和微信支付 API v3 的 Adapter；支付渠道不使用优先级或权重，前台展示可用渠道并由用户选择具体 `channelId`。
- 新增用户支付渠道/创建订单/查询订单/主动同步/回调接口，以及管理员渠道配置、启停和配置验证接口。
- 个人中心已加入充值入口，支持支付方式、支付场景和具体渠道选择，并按订单状态轮询刷新余额。
- 本地没有 PostgreSQL、Redis、真实商户沙箱和公网回调环境；本地已完成 schema、类型、支付单元测试和构建验证。远程已使用易支付真实成功订单验证 GET 回调、查单兜底和钱包入账，支付宝官方、微信支付 API v3 仍需各自沙箱凭据联调。
- 远程 `lch:/root/lumina` 已拉取提交 `a519dbc`；重新生成 Prisma Client 后，最新后端 `test`（21 个 suite / 92 个测试）和 `build` 通过，隔离 Compose 冒烟也通过并已清理专用容器、网络和数据卷。随后使用原始易支付 GET 通知验证订单 `LM20260919043915205578276370` 已成功入账；支付宝、微信官方渠道和退款仍待沙箱联调。

## 本次模块：平台光子货币与充值汇率

- 钱包、账本、聊天、生图和提示词优化的所有消费统一使用光子；平台模型价格由管理员直接设置光子数量。
- 光子符号统一为 `✦`；现有模型价格、钱包余额和历史费用按数值 1:1 迁移为光子，不使用汇率放大。
- 管理后台新增 `1 人民币 = N 光子` 的充值汇率设置。汇率只用于充值入账换算，不影响消费价格、已有余额或历史账单。
- 新增 `GET/PATCH /admin/settings/currency`，汇率变更写入审计日志；实际支付模块接入时，应先将外部充值金额换算为光子，再调用 `WalletService.recharge()`。

## 当前状态基准（2026-09-17）

### 本次核对结果

- 提示词优化模型已支持在管理后台从现有 `CHAT` 平台模型中选择；配置写入数据库，`PROMPT_OPTIMIZER_MODEL` 仅作为未保存后台配置时的兼容兜底。
- 已完整核对 `apps/backend`、`apps/frontend`、共享类型、Prisma schema、Docker Compose 和现有文档；生产数据库已切换到版本化 baseline migration。
- 使用现有本地依赖直接运行后端 Jest：**18 个测试套件、72 个测试全部通过**（包含提示词优化配置、管理员校验审计和实际聊天适配器调用计费测试）。
- 共享类型编译、Nest 后端构建、Next 前端生产构建均通过；前端已生成 `/login`、`/chat`、`/image`、`/history` 和 `/admin` 路由。
- 本机未启动前端、后端、PostgreSQL、Redis、MinIO 或 SMTP；认证验证码现已通过 mock SMTP 单元测试，但仍未执行真实认证、聊天、生图的端到端验证。
- 根脚本固定 `pnpm@8.15.0`，当前环境为 pnpm 11；本机根级命令仍受 pnpm 版本与既有依赖目录影响。`lint` 已改为只读检查，格式修复必须显式执行 `lint:fix`。
- 已在 `lch:/root/lumina` 使用 pnpm 8.15.0 完成根级 lint、test、build，以及最终提交的隔离 API/E2E smoke；lint 无 error，但保留历史格式 warning。

### 实际完成度

| 范围 | 当前状态 | 证据与限制 |
| --- | --- | --- |
| 项目脚手架、Docker Compose、Prisma schema | 已实现并接入版本化迁移 | baseline migration 已在远程旧库和独立空库验证；本机未启动容器。 |
| 邮箱验证码登录、JWT、用户初始化钱包 | 代码与 mock SMTP 单元测试已验证 | 验证码仅在投递成功后写入 Redis；失败会清理验证码和 60 秒冷却状态；真实 SMTP 与数据库/Redis 联调仍待补。 |
| 钱包与账本 | 代码与单元测试已验证 | 预扣、结算、退回和 RBAC 相关安全改动有单元测试；未接真实 PostgreSQL/Redis 联调。 |
| Provider、模型路由、限流/熔断 | 代码、单元测试和远程 mock Provider E2E 已验证 | Provider 限流已使用 Redis ZSET + Lua 滑动窗口；远程 smoke 已验证限额为 1 时同窗口第二次聊天请求被拒绝。真实供应商路由仍待验证。 |
| 聊天后端与前端 | 代码已实现、构建通过 | 聊天 UI、SSE 解析、会话 CRUD 调用均存在；没有聊天 API/流式/计费端到端测试。 |
| 生图后端与前端 | 代码、单元测试和远程 mock Provider E2E 已验证 | 前端已接入模型、优化、创建任务、轮询和历史；后端已使用 Redis 持久化队列、重试与启动恢复，并将稳定任务幂等键传给图片上游。远程 smoke 已验证图片队列、MinIO 和任务结算，真实供应商幂等语义仍待确认。 |
| 历史记录独立页 | 代码已实现、前端构建通过 | `/history` 已接入用户自己的聊天会话与生图历史，支持各自分页、加载、空状态和错误重试；未接本地后端/数据库做端到端验证。 |
| 管理后台与审计 | 代码、单元测试、前端构建和远程隔离 E2E 已验证 | `/admin` 已接入概览、用户/账本/余额调整、模型/供应商/上游映射、提示词优化模型选择和审计日志；提示词优化只能选择已有且可用的 `CHAT` 模型；真实供应商和浏览器流程仍待验证。 |
| 模块化支付渠道 V1 | 代码、支付单元测试、类型检查、构建、远程隔离环境和易支付真实订单已验证 | 已接入易支付 V1、支付宝官方、微信支付 API v3；前台展示可用渠道并由用户选择，不做优先级/权重或自动切换。易支付真实 GET 回调、查单兜底、订单幂等和钱包入账已验证；支付宝/微信官方沙箱、重复回调、金额攻击和退款仍待补验。 |
| CI | 已配置，远程按 CI 工具链复跑通过 | 工作流固定 Node 20 / pnpm 8.15.0；GitHub Actions 首次运行结果仍待平台触发后确认。 |

### API/E2E 测试环境（已实现，远程冒烟通过）

- 新增 `docker-compose.e2e.yml`，使用独立命名卷启动 PostgreSQL、Redis、MinIO、MailHog、mock Provider、backend 和 frontend，不复用开发/生产数据。
- 新增无额外依赖的 mock Provider，支持 OpenAI 兼容聊天非流式/流式接口和图片 base64 接口；图片接口会按 `Idempotency-Key` 复用响应；MailHog 提供可读取验证码的 SMTP 测试服务。
- 新增 `tests/e2e/smoke.mjs`，覆盖验证码登录、管理员初始化、普通用户 RBAC、供应商/模型/上游配置、聊天 SSE、生图队列与 MinIO、历史和审计日志。
- 管理端供应商及上游映射响应已移除 `config.apiKey`，保留非敏感配置摘要；内部 Provider 路由仍使用完整配置。
- 本地已通过 18 个后端测试套件/72 个测试、Nest/Next 生产构建和 smoke/mock 脚本语法检查；本机未安装 Docker。
- 远程 `lch:/root/lumina` 已拉取提交 `6ee5917`，启动隔离 Compose 环境并通过完整冒烟：验证码登录、管理员初始化、RBAC、用户状态启停、停用 JWT 拦截、余额调整、账本、Provider 滑动窗口限流、配置脱敏、提示词优化模型选择与调用、聊天 SSE、生图队列、MinIO、历史和审计；测试完成后已清理隔离容器、网络和专用卷。

### 当前交付阻塞项

1. **运行环境未就绪**：需要 PostgreSQL、Redis、MinIO、有效 `JWT_SECRET`、SMTP 及至少一个可用 AI Provider/模型后，才能做端到端验收。
2. **验证覆盖不足**：认证、聊天 SSE、生图队列、管理配置、管理员用户状态/余额/审计及 Provider 限流 API 旅程已在 mock 环境通过；真实供应商和浏览器关键流程仍未验证。
3. **工具链不一致**：本地仍需使用 pnpm 8.15.0（与 CI 一致）和干净依赖目录，才能复现根级验证；lint 的只读检查与显式 `lint:fix` 已拆分。

### 后续待办

- [x] 将管理后台的平台模型配置从 JSON 文本改为按模型类型展示的结构化表单，至少覆盖聊天模型的 input/output 价格和生图模型的 perImage 价格，并补充前后端校验。
- [x] 将管理后台的供应商配置从 JSON 文本改为结构化输入框，覆盖 API Key、Base URL、请求超时和每分钟限流，并补充前后端校验。
- [x] 为生产数据库建立由当前 Prisma schema 生成的 baseline migration，并将容器启动从 `db push` 切换为带旧库兼容校验的 `migrate deploy`。
- [x] 为提示词优化增加后台模型选择，复用现有 `CHAT` 模型，并补充数据库配置迁移、接口、计费调用和测试覆盖。

### 提示词优化模型配置与调用 ✓

- `system_configs` 保存已选的既有 `CHAT` 平台模型；管理后台提供读取和更新入口，后端校验模型类型、启用状态、可用上游和聊天协议格式。
- 优化请求复用现有聊天 Provider/Adapter，按真实 token 用量结算；后台未保存选择时兼容读取 `PROMPT_OPTIMIZER_MODEL`，不新增独立优化模型或供应商配置。
- 前端优化按钮不再依赖 IMAGE 模型列表；新增 Settings、Admin、ImageService 单测和远程 E2E 断言，覆盖配置、调用、RBAC、审计与限流场景。
- 提交 `6ee5917` 已推送并在 `lch:/root/lumina` 通过完整隔离 smoke，随后清理测试资源。

### 生产数据库 baseline migration（D-001）✓

- 新增 `apps/backend/prisma/migrations/20260917000000_baseline/migration.sql`，覆盖当前全部枚举、表、索引和外键；SQL 已与 `prisma migrate diff --from-empty --to-schema-datamodel ... --script` 输出比对。
- backend 镜像通过 `apps/backend/docker-entrypoint.sh` 在启动前执行 `prisma migrate deploy`。新数据库直接应用 baseline；历史 `db push` 数据库只有在只读 schema diff 返回无差异时才执行 `migrate resolve --applied`。
- 旧库 schema 有差异、迁移命令异常或 baseline 接管失败时，容器不启动，等待人工迁移处理；不会再由启动命令静默修改生产结构。
- 本地 schema 校验、18 个 backend 测试套件/72 个测试、Nest 构建通过；远程验证覆盖既有生产库接管、独立空库 baseline、完整 E2E smoke、生产健康检查和迁移状态检查。

### 管理后台平台模型计费表单 ✓

- 平台模型新建表单不再要求管理员编辑 JSON；`CHAT` 显示输入/输出单价（光子/千 token），`IMAGE` 显示单张价格，并在页面提交前校验非负有限数字。
- 共享类型将平台模型计费收窄为 `ChatModelPricing | ImageModelPricing`，并按模型类型关联对应字段。
- 后端 DTO 校验计费对象必须与模型类型匹配且不能包含多余字段；service 在创建和更新时再次校验，更新模型类型时会校验合并后的已有计费配置。
- 新增平台模型计费校验单测 9 项；当前后端全量为 17 个测试套件、63 个测试通过，Nest/Next 生产构建通过。

### 管理后台供应商结构化配置表单 ✓

- 供应商新建表单不再要求管理员编辑 JSON；改为 API Key、Base URL、请求超时（毫秒）和限流（次/分钟）四个输入框。
- 切换 OpenAI、Anthropic、Stability 等 API 格式时会填充对应默认地址和超时时间，同时保留管理员已经自定义的值；API Key 使用密码输入框，列表摘要和审计数据不展示密钥。
- 前端提交前校验 HTTP(S) 地址和正整数；后端 DTO 与 service 对配置字段、API Key、Base URL、超时和限流做相同校验，并保留缺省可选字段的旧数据兼容性。
- 新增供应商配置校验单测 7 项；当前后端全量为 17 个测试套件、63 个测试通过，Nest/Next 生产构建通过。

### 管理端用户状态与余额审计 E2E 验证 ✓

- `tests/e2e/smoke.mjs` 现已覆盖普通用户访问管理接口的 403、管理员用户搜索/详情、停用与恢复，以及停用期间使用既有 JWT 访问受保护接口返回 401。
- 同一冒烟流程调整用户余额 `+2.5`，验证管理员详情余额从 `10` 持久化为 `12.5`，并在管理员账本中出现 `ADMIN_ADJUST` 交易及原因。
- 审计接口同时验证 `user.status.updated` 的 ACTIVE→SUSPENDED 前后值，以及 `wallet.balance.adjusted` 的余额前后值和目标用户。
- 提交 `ad02762` 已在 `lch:/root/lumina` 的隔离 Compose 环境通过；测试结束后已清理容器与专用卷。

### Provider 滑动窗口限流（P-001）✓

- Provider 限流由按分钟编号的 Redis `INCR + EXPIRE` 固定窗口改为 ZSET + Lua 原子滑动窗口，使用 Redis 服务端时间清理过期请求并写入当前配额。
- 新增 Redis 限流脚本和 Provider 参数单测；E2E smoke 将聊天上游限额设为 1，验证首个请求成功、同窗口第二次请求返回 503。
- 提交 `3a61940` 已在 `lch:/root/lumina` 隔离 Compose 环境通过，测试容器、网络和专用卷已清理。

### 生图恢复的上游幂等（I-001）✓

- 生图任务的 `image:<taskId>` 同时用于钱包预扣/结算和图片上游请求的 `Idempotency-Key`，覆盖 OpenAI Images、OpenAI-compatible 和 Stability Image 两类调用。
- 生图服务单测验证稳定键传入请求封装；mock Provider 对相同键复用图片响应，支持远程环境验证恢复重试的结果一致性。
- 这属于上游协作式幂等：真实供应商若忽略该请求头，仍不能完全排除重复生成；任务 lease/heartbeat 和显式“上游已接受”状态保留为后续增强项。
- 提交 `1001ed1` 已在 `lch:/root/lumina` 的隔离 Compose 环境通过完整 smoke，测试资源已清理。

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
- 上游图片请求统一携带稳定的 `Idempotency-Key: image:<taskId>`，启动恢复后由支持该协议的上游复用原请求结果。
- 新增队列及生图服务单元测试，验证入队、原子领取/确认、重复领取拦截、失败重试和两类图片请求的幂等头；后端当前全量 18 个测试套件、72 个测试及生产构建通过。
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
- 配置页可查看全量（含停用）平台模型、供应商和指定模型的上游映射；支持新建配置，以及模型/供应商/上游映射的启停。供应商密钥仅用于上游调用，管理列表只显示非敏感配置摘要。
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

### 步骤 2：用户模块 + 注册/登录认证（代码已实现，真实 SMTP 联调待补）

- commit: `62134d5`
- 独立注册流程：邮箱验证码、昵称、密码和确认密码；注册后创建钱包并返回 JWT
- 已注册用户支持邮箱验证码登录和密码登录；验证码登录不再自动创建用户
- 登录/注册验证码使用独立 Redis Key，验证码 5 分钟 TTL 且原子一次性消费
- JWT 认证（7天过期）
- 注册创建钱包并赋予初始额度（默认 10.00 光子）
- 前端统一认证布局：密码登录、验证码登录和注册页
- middleware 路由保护（/chat, /image, /history, /admin）
- **当前状态**：类型检查、认证单元测试和 E2E 冒烟脚本已更新；真实 SMTP、PostgreSQL、Redis 和容器构建待远程验证。

### 步骤 2-1：认证验证码投递可靠性（A-001）✓

- 验证码投递前使用独立 Redis 冷却 key 原子限频，60 秒内并发或重复请求不会重复发信。
- 仅在 SMTP 投递成功后写入 5 分钟验证码；投递或保存失败会清理验证码和冷却状态，失败后可立即重试。
- 发送和登录统一 trim/lowercase 邮箱；限频错误按 Redis TTL 准确提示剩余秒数。
- 新增 mock SMTP 单元测试，覆盖成功投递、失败清理、失败重试、并发限频、验证码一次性使用和错误登录失效。
- 当前认证测试覆盖注册、密码登录、验证码登录和邮件投递；真实 SMTP 与 API/E2E 旅程仍需远程环境验收。

### 步骤 3：钱包/账本模块 ✓

- commit: `c16dc96`
- 三阶段计费：preDeduct（Redis 预扣锁定）→ settle（Prisma 事务结算）→ refund（退回）
- 幂等键机制：idempotencyKey 防重复交易
- 交易记录分页查询
- 充值、管理员调整余额
- API: `GET /wallet/balance`, `GET /wallet/transactions?page=1&limit=20&type=RECHARGE|CONSUME|REFUND|ADMIN_ADJUST`
- 已知技术债务记录在 `docs/known-issues.md`（W-001 并发安全非原子, W-002 竞态）

### 步骤 4：平台模型 + 上游供应商模块 ✓

- commit: `92fe985`
- Schema 新增 `PlatformModel`、`UpstreamModel` 两张表
- Provider 表扩展 `apiFormat`（openai_chat/openai_compatible/anthropic_messages/openai_image/stability_image）和 `supportsStreaming`
- 平台模型名映射多个上游，按 priority + weight 路由
- 熔断器（Redis 实现）：失败计数 + 熔断打开，TTL 自动恢复
- 限流（Redis 滑动窗口）：ZSET + Lua 原子清理、计数和配额写入
- `resolveUpstream` 返回 `recordResult` 回调，调用方回报结果影响熔断器
- 管理端 API：平台模型/供应商/上游映射全套 CRUD
- RedisService 新增 `incr` 方法
- P-001 已修复：Provider 限流改为一分钟 Redis ZSET + Lua 滑动窗口，记录在 `docs/known-issues.md`

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
│   │   │       ├── auth/                  # 注册、密码/邮箱验证码登录 + JWT（SMTP 配置后才可用）
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
│       │       ├── page.tsx               # 公开首页：AI 生图与 AI 聊天入口
│       │       ├── login/page.tsx         # 登录页（已实现）
│       │       ├── register/page.tsx      # 注册页（已实现）
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
- `POST /auth/register/send-code` — 发送注册验证码
- `POST /auth/register` — 邮箱验证码注册并返回 JWT
- `POST /auth/login` — 已注册用户验证码登录
- `POST /auth/password-login` — 密码登录

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
- `GET /admin/settings/prompt-optimizer` — 获取提示词优化模型配置
- `PATCH /admin/settings/prompt-optimizer` — 从已有聊天模型中选择提示词优化模型
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
