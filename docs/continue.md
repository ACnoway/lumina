# Lumina 续开发交接

> 更新日期：2026-09-19
> 验证提交：个人中心导航重构提交（本次分支 HEAD）
> 分支状态：个人中心已改为分区导航结构；本地类型与页面 lint 已通过，远程构建、完整 E2E 和浏览器验收均已通过。

## 平台光子货币规则

- 所有平台消费和模型价格统一使用光子，展示符号为 `✦`；管理员设置模型价格时直接填写光子数量。
- 现有模型价格、钱包余额和历史费用按数值 1:1 视为光子，不套用充值汇率。
- 后台汇率定义为 `1 人民币 = N 光子`，只在充值/支付成功入账前换算；汇率修改不影响既有余额、历史账单或消费价格。
- 后台货币接口为 `GET/PATCH /admin/settings/currency`，修改会写入审计日志；支付模块应使用 `SettingsService.convertCnyToPhoton()` 后再调用 `WalletService.recharge()`。

## 先读这份文档

Lumina 是一个 pnpm + Turborepo 单体仓库：Next.js App Router 前端、NestJS 后端、Prisma/PostgreSQL、Redis、MinIO，以及 OpenAI/Anthropic 兼容的聊天与生图上游。

开始工作前，以当前源码和可复现结果为准；冲突时优先级为：

```text
实际代码与运行结果 > Git 提交历史 > docs/progress.md > README
```

请保持小步、单模块开发。不要在同一次提交中重构无关模块、升级依赖或全仓格式化。

## 已完成模块

- 个人中心已改为桌面端左侧导航、移动端横向标签导航；账户概览、充值与钱包、安全设置已分区展示，消费记录和个性化设置保留扩展入口。
- 登录/JWT、用户和钱包基础链路已实现；验证码投递可靠性已修复并有 mock SMTP 单元测试；钱包的预扣、结算、退款与并发/幂等保护已有单元测试。
- Provider、平台模型和上游映射已具备管理员 RBAC、审计日志、优先级/权重路由、基础限流与熔断。
- 聊天的会话、SSE 流式、钱包和 Provider 调用链已实现；真实上游端到端验证尚未完成。
- 生图前端、任务查询/历史、Redis 持久化队列、重试及启动恢复已实现。
- 生图恢复重试已向 OpenAI Images、OpenAI-compatible 和 Stability Image 请求透传稳定的 `Idempotency-Key: image:<taskId>`；mock Provider 会按键复用响应。
- 历史页已接入用户自己的聊天会话与生图任务，支持分页、加载、空状态和错误重试。
- 管理后台已接入概览、用户/账本、余额调整、模型、供应商、上游映射与审计日志；管理员可看到停用模型，普通用户仍只能看到启用模型。服务启动时会按 `ADMIN_EMAIL` 幂等初始化管理员账户。
- 管理后台平台模型已改为按 `CHAT/IMAGE` 类型展示光子计费表单；聊天模型填写 `input/output`，生图模型填写 `perImage`，前后端均拒绝不匹配或负数配置。
- 提示词优化模型配置使用已有的 `CHAT` 平台模型，后台选择写入 `system_configs`；`PROMPT_OPTIMIZER_MODEL` 只作为未保存后台配置时的兼容兜底。
- 管理后台供应商已改为 API Key、Base URL、请求超时和限流输入框；前后端均校验配置格式，列表和审计不暴露 API Key。
- 已建立独立 API/E2E Compose 环境，包含 PostgreSQL、Redis、MinIO、MailHog、mock Provider、backend 和 frontend；认证、RBAC、管理端用户状态启停/余额账本/审计、聊天、生图和管理配置旅程已在远程通过。
- CI 工作流已固定 Node 20 与 pnpm 8.15.0。
- 已建立 Prisma baseline migration；生产 backend 启动使用 `prisma migrate deploy`，并对旧 `db push` 数据库执行无差异校验后自动接管。

## 本次模块：提示词优化模型配置与真实调用 ✓

管理后台新增“模型与供应商 → 提示词优化模型”配置，可从已有的平台 `CHAT` 模型中选择并保存到
`system_configs`。后端只允许选择启用、存在可用聊天上游且格式兼容的模型；普通用户不能读取或修改该配置，
管理员修改会写入审计日志。删除或清空配置后，服务仍可读取 `.env` 中的 `PROMPT_OPTIMIZER_MODEL` 作为兼容兜底。

`POST /image/optimize-prompt` 已接入现有聊天 Provider/Adapter 路由，使用实际选中的模型调用上游，并按实际
输入/输出 token 结算；未配置或模型不可用时返回明确错误。生图页的优化按钮不再错误依赖是否存在 IMAGE 模型。

本地已通过 18 个 backend 测试套件/72 个测试、共享类型编译、Nest/Next 生产构建、lint 和 smoke 脚本语法检查。
提交 `6ee5917` 已推送并由 `lch:/root/lumina` 拉取；远程隔离 Compose 冒烟已验证后台选择、普通用户优化调用、
聊天模型路由、计费、RBAC 和审计，测试完成后已清理专用容器、网络和卷。

详细的功能范围、API 和限制见 `docs/progress.md`；已知风险见 `docs/known-issues.md`。

## 最新验证基线

以下命令已在当前依赖目录执行成功：

```powershell
Set-Location apps\backend
.\node_modules\.bin\jest.CMD --runInBand
.\node_modules\.bin\nest.CMD build

Set-Location ..\frontend
.\node_modules\.bin\next.CMD build
```

- 后端 Jest：18 个套件、72 个测试通过，包含 Settings、Admin 和 ImageService 的提示词优化覆盖。
- Nest 生产构建通过。
- Next 生产构建通过，包含 `/admin` 和 `/image` 路由。
- 新增/修改的认证文件已通过 Prettier 检查。

当前机器安装的是 pnpm 11，而仓库固定 pnpm 8.15.0。根级 `pnpm lint`、`pnpm test` 和 `pnpm build` 会因既有 `node_modules` 与 pnpm 版本不匹配而在执行任务前中止；不要为了绕过它删除或重建当前依赖目录。若要做完整根级验证，应先在干净环境使用 pnpm 8.15.0 与 lockfile 安装依赖。

后端的 `lint` 脚本带有 `--fix`，不是只读检查；运行前先确认工作区干净，避免意外改写大量 CRLF 文件。

## 当前外部环境阻塞

- 本机没有项目 `.env`，也没有运行 PostgreSQL、Redis、MinIO 或前后端服务；本地完整 E2E 仍需 Docker。
- mock SMTP、PostgreSQL、Redis、MinIO 和 mock Provider 的 API 最小旅程已在 `lch:/root/lumina` 通过并清理；真实 SMTP/Provider 与浏览器流程仍未验证。
- 管理端已在远程隔离 PostgreSQL/Redis 环境验证角色边界、用户状态启停、停用后的 JWT 拦截、余额调整、账本记录、供应商/模型/上游创建、配置脱敏、提示词优化模型选择、计费和审计；Provider 滑动窗口限流也已用真实 Redis 验证。真实供应商、浏览器流程和长期运行仍需补验。

## 本次模块：认证验证码投递可靠性（A-001）✓

本次已处理 `apps/backend/src/modules/auth/`，修复验证码邮件失败时的状态残留并补齐可 mock 的单元测试。

实现结果：`AuthService.sendCode()` 先原子占用独立 60 秒冷却 key，邮件成功后才写入 5 分钟验证码；邮件或 Redis 保存失败都会清理认证状态，登录和发送统一规范化邮箱，限频提示按剩余秒数返回。

已验证：

1. `auth.service.spec.ts` 的 6 个认证单元测试通过，SMTP 完全 mock。
2. 后端全量 Jest 的 14 个测试套件、50 个测试通过。
3. Nest 生产构建通过。
4. 未改变现有 `POST /auth/send-code` 与 `POST /auth/login` 的 API 路径或成功响应格式。

真实 SMTP、PostgreSQL、Redis 和 API/E2E 验收仍需在远程环境完成。

## 本次修复：管理员账户自动初始化 ✓

服务启动时读取 `ADMIN_EMAIL`，不存在时自动创建 `ADMIN` 账户和钱包；
`ADMIN_PASSWORD` 以 bcrypt 哈希保存。若配置邮箱已经存在但仍是 `USER`，
启动时会修复为 `ADMIN`，已有管理员角色不会被降级。Docker Compose 已将
管理员配置传递给 backend，并新增 3 个初始化单元测试。

## 本次模块：平台模型结构化计费表单 ✓

管理后台的平台模型新建表单已移除计费 JSON 文本框，改为按模型类型显示价格输入：
`CHAT` 使用每千 token 的 `input/output`，`IMAGE` 使用每张图片的 `perImage`。
前端提交前校验非负有限数字；后端 DTO 校验字段集合和类型，service 在创建及更新（含模型类型切换）时再次校验。
共享类型同步收窄为按类型的计费结构，并新增 9 项校验测试。

## 本次模块：供应商结构化配置表单 ✓

管理后台的供应商新建表单已移除 JSON 文本框，改为四个结构化输入：API Key、Base URL、请求超时（毫秒）和限流（次/分钟）。切换 API 格式时会带出 OpenAI、Anthropic 或 Stability 的默认地址和超时时间，并保留管理员自定义的值。

前端提交前校验 HTTP(S) 地址和正整数；后端 DTO 与 service 对支持字段、API Key、Base URL、超时和限流做校验，同时允许旧配置缺省非必填字段。API Key 使用密码输入框，供应商列表只展示非敏感配置摘要，既有审计逻辑也不会记录密钥。

新增 `provider-config.spec.ts`，覆盖合法配置、空密钥、非法 URL、非整数超时、无效限流、多余字段和 service 直接调用保护，共 7 项测试。

## 本次模块：管理端用户状态与余额审计 E2E 验证 ✓

`tests/e2e/smoke.mjs` 已补充管理员检索用户、获取详情、停用/恢复用户、停用期间 JWT 访问拒绝、余额调整、账本查询及审计前后值断言；普通用户访问管理用户接口也有 403 断言。

本地已通过 smoke 脚本语法和 diff 检查；提交 `ad02762` 已推送并由 `lch:/root/lumina` 拉取。远程隔离 Compose 冒烟测试通过，随后已清理该测试项目及其专用卷。

## 本次模块：Provider 滑动窗口限流（P-001）✓

Provider 限流已从按分钟编号的 `INCR + EXPIRE` 固定窗口改为 Redis ZSET + Lua 原子滑动窗口。脚本使用 Redis 服务端时间，清理窗口外请求后再判断和写入配额，避免多实例时钟差异及并发竞态。

新增 Redis 限流脚本单测、Provider key/参数单测，并在 E2E smoke 中将聊天上游限额设为 1，验证同一窗口第二次请求被路由层拒绝。提交 `3a61940` 已在 `lch:/root/lumina` 的隔离 Compose 环境通过。

## 本次模块：生图恢复的上游幂等（I-001）✓

生图任务继续使用 `image:<taskId>` 作为钱包幂等键，并将同一个稳定键透传到 OpenAI Images、OpenAI-compatible 和 Stability Image 的 `Idempotency-Key` 请求头。这样任务在上游已完成、但本地状态尚未落库而被恢复时，支持该约定的上游可以复用原请求结果，不会因为 Lumina 重试而创建新的生成请求。

新增图片服务单测，覆盖任务键从处理链路传入两类请求封装并出现在 HTTP 请求头；E2E mock Provider 也会按键缓存图片响应。提交 `1001ed1` 已在 `lch:/root/lumina` 的隔离 Compose 环境通过完整 smoke，真实供应商是否执行幂等仍取决于其 API 契约，后续可在配置真实 Provider 后做受控验证。

## 本次模块：生产数据库 baseline migration（D-001）✓

新增 `apps/backend/prisma/migrations/20260917000000_baseline/migration.sql`，由当前
`schema.prisma` 生成并经过 SQL 内容比对；backend 新增 `prisma:migrate:deploy` 与
`prisma:migrate:status` 脚本。

生产镜像不再在启动时执行 `db push`，改由 `docker-entrypoint.sh` 执行
`prisma migrate deploy`。对于历史上由 `db push` 初始化、但没有 `_prisma_migrations`
的数据库，入口仅在 `prisma migrate diff --exit-code` 确认数据库与当前 schema 完全一致后
执行 `migrate resolve --applied 20260917000000_baseline`；有差异或其他迁移错误时拒绝启动，
避免静默改表。

已验证：本地 schema 校验、baseline SQL 与 `prisma migrate diff` 一致性检查、backend
17 个测试套件/64 个测试和 Nest 构建通过；`lch:/root/lumina` 的既有数据库成功完成
baseline 接管，独立空库成功执行 baseline，完整 API/E2E smoke 通过，生产 backend
健康检查和 `prisma migrate status` 均正常。E2E 专用容器、网络和卷已清理。

## 本次模块：验证工具链安全化（A-003）✓

根级 `lint` 和后端 `lint` 现在都是只读检查；新增根级、后端和前端的
`lint:fix` 显式修复命令，并在 Turborepo 中注册对应任务。管理端供应商响应的
API Key 脱敏逻辑改为复制配置后删除敏感字段，消除了只读 lint 的实际未使用变量错误。

远程 `lch:/root/lumina` 使用 pnpm 8.15.0 验证通过：根级 lint（0 errors，保留历史
格式 warning）、17 个测试套件/64 个测试和根级 build；最终提交的隔离 E2E smoke
也已通过并清理全部专用容器、网络和卷。现有 Prettier 格式 warning 未全仓自动修复，
后续可按文件分批处理。

## 随后的开发顺序

1. 配置真实 SMTP 和真实 AI Provider 后，补做受控认证、聊天、生图与浏览器流程验收。

## 关键约束

- 只能让用户读取和修改自己的聊天、图片历史和钱包数据。
- 普通 `USER` 不得读取或修改管理配置；所有敏感管理员 mutation 必须保持 RBAC 与 AuditLog。
- 所有收费上游调用遵循 `preDeduct → upstream → settle/refund`，重试不能重复扣费。
- Provider 路由逻辑保持在 Provider/Adapter 层；不要把供应商分支堆进 ChatService 或 ImageService。
- 不要把未配置外部服务时的构建或单元测试通过，表述为生产可用或端到端验证完成。

## 开发完成后的交接模板

```text
## Changed
本次模块与边界

## Files
涉及的文件

## Tests
新增/执行的测试和结果

## Build
构建与静态检查结果

## Existing Problems
发现但未处理的问题

## Next
下一项推荐任务与前置条件
```
