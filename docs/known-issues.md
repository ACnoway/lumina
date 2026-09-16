# 已知问题与技术债务

> 记录开发过程中发现但暂不修复的 bug、限制和技术债务。
> 每条记录格式：模块 → 问题描述 → 影响 → 建议方案 → 优先级。

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

## 已修复的问题

> 以下问题已在开发过程中修复，保留记录用于回顾。

### W-000 · settle 方法异常被 try-catch 吞掉（已修复）

- **发现时间**：2026-08-14（第三步开发）
- **文件**：`apps/backend/src/modules/wallet/wallet.service.ts` → `settle()`
- **问题**：subagent 初版代码在 `settle()` 外层包了 try-catch，将事务内抛出的 `BadRequestException`（余额不足）和 `NotFoundException`（钱包不存在）统一转换为 `InternalServerErrorException`（500 错误），前端无法获得正确的错误状态码。
- **修复方式**：移除外层 try-catch，让 NestJS 内置异常正常传递。事务内的 `BadRequestException` 和 `NotFoundException` 会自动映射为 400/404 响应。
- **状态**：已修复（2026-08-14）
