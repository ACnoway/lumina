# 已知问题与技术债务

> 记录开发过程中发现但暂不修复的 bug、限制和技术债务。
> 每条记录格式：模块 → 问题描述 → 影响 → 建议方案 → 优先级。

---

## 认证模块（Auth）

### A-001 · 邮箱验证码发送依赖 SMTP，失败时接口返回 400（代码已修复，真实 SMTP 验收待补）

- **发现时间**：2026-09-16（现状核对）
- **文件**：`apps/backend/src/modules/auth/auth.service.ts` → `sendCode()`
- **历史现象**：浏览器调用 `POST /api/auth/send-code` 收到 HTTP 400。前端通过 Next.js rewrite 转发到 `POST /auth/send-code`，路由本身存在；服务在 `transporter.sendMail()` 失败时显式抛出 `BadRequestException('邮件发送失败，请稍后重试')`。
- **当前环境证据**：仓库没有本地 `.env`，本机也没有启动后端、Redis、PostgreSQL 或 MinIO。`.env.example` 和 Docker Compose 的默认 SMTP 主机为 `smtp.example.com`，仅是示例配置，无法投递真实邮件。因此当前登录不能标记为可用；本次未连接真实 SMTP，不能断言具体供应商错误。
- **额外缺陷（已修复）**：验证码此前在调用 `sendMail()` 前就被写入 Redis，邮件发送失败后 key 未清理；限频提示也把剩余 TTL 错当成分钟。现改为独立 Redis 冷却 key 原子限频，仅在投递成功后保存验证码，失败清理验证码和冷却状态，并按秒提示。
- **影响**：未配置或配置错误的 SMTP 会导致所有新用户和已注册用户无法登录；第一次投递失败后，短时间内无法立即重试。
- **已完成**：仅在成功投递后保存验证码；使用独立的 60 秒 `setNX` 冷却 key；投递失败清理验证码和冷却状态；统一邮箱规范化和剩余秒数提示；增加 mock SMTP 的成功、失败清理、失败重试、并发限频、一次性使用和登录失败测试。
- **后续建议**：启动时校验 SMTP 必填配置，部署前使用 `transporter.verify()` 做健康检查；在 MailHog 或真实 SMTP 可用后补 API/E2E 验收。
- **优先级**：P0
- **状态**：代码已修复（2026-09-16），待配置真实 SMTP 并完成端到端验证。

### A-002 · 认证、聊天和生图缺少端到端测试（测试环境已补，远程验收待执行）

- **发现时间**：2026-09-16（现状核对）
- **问题**：现有 15 个单元测试套件、57 个测试覆盖核心服务、计费校验和供应商配置校验；此前没有认证邮件、JWT 登录、聊天 SSE、图片任务、MinIO 上传或真实数据库/Redis 的 API/E2E 测试。
- **影响**：模块可构建和单元测试通过不代表配置、网络、第三方服务和真实请求链路可用；认证、聊天、生图和管理端仍缺少完整 E2E。
- **建议方案**：使用新增的 `docker-compose.e2e.yml` 和 `tests/e2e/smoke.mjs`，在远程 Docker 环境中执行登录到聊天/生图的最小用户旅程；真实供应商再单独做受控冒烟测试。
- **优先级**：P0
- **状态**：测试环境与最小冒烟脚本已实现（2026-09-16），待远程执行确认。

### A-003 · 根级验证受 pnpm 版本不一致阻塞

- **发现时间**：2026-09-16（现状核对）
- **问题**：项目声明 `packageManager: pnpm@8.15.0`，但当前环境为 pnpm 11.19.0。执行根级 `pnpm lint`、`pnpm test`、`pnpm build` 时，pnpm 在依赖目录检查阶段要求清理不兼容的 node_modules，并在非交互会话中中止。
- **影响**：无法以仓库定义的根脚本完成当前基线验证；CI 与本地的工具链结果也可能不一致。
- **建议方案**：统一开发机和 CI 使用 pnpm 8.15.0，先以干净安装执行 `pnpm install --frozen-lockfile`；同时把 lint 拆分为只检查的 `lint` 和显式修复的 `lint:fix`，避免验证命令改写源文件。
- **优先级**：P1
- **状态**：未修复。

---

## 钱包模块（Wallet）

### W-001 · preDeduct 并发安全非原子操作（已修复）

- **发现时间**：2026-08-14（第三步开发）
- **文件**：`apps/backend/src/modules/wallet/wallet.service.ts` → `preDeduct()`
- **问题**：预扣流程中「检查余额」和「写入 Redis 预扣记录」是两步非原子操作。当前代码先 `redis.get()` 检查幂等键是否存在，再 `redis.set()` 写入。高并发下同一用户可能绕过检查重复预扣，导致锁定金额超过实际余额。
- **影响**：单用户高并发请求场景下可能超额锁定。当前阶段用户量低、预扣金额有上限，实际风险较小。
- **建议方案**：在 `RedisService` 中暴露 `setNX(key, value, ttl)` 方法，使用 Redis `SET key value NX EX <ttl>` 原子命令替代当前的 get-then-set 两步操作。同时可考虑用 Redis 分布式锁（`SET lock:wallet:{userId} NX EX`）保护余额检查+预扣写入整个流程。
- **修复时间**：2026-09-16
- **修复方式**：使用用户级 Redis 分布式锁包住幂等检查、余额检查和 reservation 写入，并用 Redis transaction 原子写入预扣记录及用户 reservation 索引。
- **验证**：100 个相同幂等键并发请求最终只创建一条 reservation。
- **状态**：已修复

### W-002 · 余额检查与预扣写入之间的竞态（已修复）

- **发现时间**：2026-08-14（第三步开发）
- **文件**：`apps/backend/src/modules/wallet/wallet.service.ts` → `preDeduct()`
- **问题**：`preDeduct` 先从数据库读取余额判断是否足够，再写入 Redis 锁定。两步之间余额可能被其他请求扣减，导致预扣时认为余额足够但实际结算时不足。结算阶段有 Prisma 事务保护会抛出 `BadRequestException`，不会造成数据不一致，但用户体验不够友好。
- **影响**：极端并发下用户可能预扣成功但结算失败，需要退回并重试。
- **建议方案**：与 W-001 一并解决，使用 Redis 分布式锁或数据库行级锁（`SELECT ... FOR UPDATE`）保护预扣流程。
- **修复时间**：2026-09-16
- **修复方式**：所有余额变更操作使用同一用户级 Redis 锁；settle 额外使用数据库 `balance >= amount` 条件更新，作为锁失效或绕过应用锁时的最终资金安全边界。
- **验证**：100 个不同幂等键并发预扣时，reservation 总额不超过钱包余额。
- **状态**：已修复

---

## 供应商模块（Providers）

### P-001 · 限流使用固定窗口而非滑动窗口

- **发现时间**：2026-08-14（第四步开发）
- **文件**：`apps/backend/src/modules/providers/providers.service.ts` → `checkRateLimit()`
- **问题**：限流使用 Redis INCR + EXPIRE 实现固定窗口计数（按分钟）。在窗口临界点（如 59 秒到 00 秒），可能短暂出现接近 2 倍限流值的流量。
- **影响**：当前阶段用户量低，实际风险极小。高并发场景下可能需要更精确的限流。
- **建议方案**：替换为滑动窗口算法（用 Redis ZSET 存请求时间戳，清理过期成员后计数）或令牌桶算法（用 Redis Lua 脚本实现原子取令牌）。
- **优先级**：低

---

## 生图队列模块（Image Queue）

### I-001 · 上游生图请求在进程崩溃后的恢复中可能重复执行

- **发现时间**：2026-09-16（持久化队列实现）
- **文件**：`apps/backend/src/modules/image/image.service.ts` → `recoverQueuedTasks()`
- **现象**：worker 在上游已经完成生成、但本地尚未写入任务成功状态时异常退出，任务会在 15 分钟后被视为过期并重新处理。
- **影响**：账本使用固定 `image:<taskId>` 幂等键，不会重复扣费；但现有 OpenAI/Stability 调用没有统一传递上游幂等键，可能产生额外的上游生成成本或重复图片。
- **建议方案**：为支持的供应商传递上游幂等键；后续若拆分独立 worker，可增加任务 lease/heartbeat 和显式的“上游已接受”状态，缩小恢复窗口。
- **优先级**：P1
- **状态**：已记录，待上游适配器支持后改进。

---

## 已修复的问题

> 以下问题已在开发过程中修复，保留记录用于回顾。

### W-000 · settle 方法异常被 try-catch 吞掉（已修复）

- **发现时间**：2026-08-14（第三步开发）
- **文件**：`apps/backend/src/modules/wallet/wallet.service.ts` → `settle()`
- **问题**：subagent 初版代码在 `settle()` 外层包了 try-catch，将事务内抛出的 `BadRequestException`（余额不足）和 `NotFoundException`（钱包不存在）统一转换为 `InternalServerErrorException`（500 错误），前端无法获得正确的错误状态码。
- **修复方式**：移除外层 try-catch，让 NestJS 内置异常正常传递。事务内的 `BadRequestException` 和 `NotFoundException` 会自动映射为 400/404 响应。
- **状态**：已修复（2026-08-14）
