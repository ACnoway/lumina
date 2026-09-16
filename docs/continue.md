# Lumina 续开发交接

> 更新日期：2026-09-16
> 基线提交：`cd1d399 feat(admin): add structured model pricing forms`
> 分支状态：`main` 与 `origin/main` 一致，已在 `lch:/root/lumina` 完成远程验收。

## 先读这份文档

Lumina 是一个 pnpm + Turborepo 单体仓库：Next.js App Router 前端、NestJS 后端、Prisma/PostgreSQL、Redis、MinIO，以及 OpenAI/Anthropic 兼容的聊天与生图上游。

开始工作前，以当前源码和可复现结果为准；冲突时优先级为：

```text
实际代码与运行结果 > Git 提交历史 > docs/progress.md > README
```

请保持小步、单模块开发。不要在同一次提交中重构无关模块、升级依赖或全仓格式化。

## 已完成模块

- 登录/JWT、用户和钱包基础链路已实现；验证码投递可靠性已修复并有 mock SMTP 单元测试；钱包的预扣、结算、退款与并发/幂等保护已有单元测试。
- Provider、平台模型和上游映射已具备管理员 RBAC、审计日志、优先级/权重路由、基础限流与熔断。
- 聊天的会话、SSE 流式、钱包和 Provider 调用链已实现；真实上游端到端验证尚未完成。
- 生图前端、任务查询/历史、Redis 持久化队列、重试及启动恢复已实现。
- 历史页已接入用户自己的聊天会话与生图任务，支持分页、加载、空状态和错误重试。
- 管理后台已接入概览、用户/账本、余额调整、模型、供应商、上游映射与审计日志；管理员可看到停用模型，普通用户仍只能看到启用模型。服务启动时会按 `ADMIN_EMAIL` 幂等初始化管理员账户。
- 管理后台平台模型已改为按 `CHAT/IMAGE` 类型展示结构化计费表单；聊天模型填写 `input/output`，生图模型填写 `perImage`，前后端均拒绝不匹配或负数配置。
- CI 工作流已固定 Node 20 与 pnpm 8.15.0。

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

- 后端 Jest：14 个套件、50 个测试通过。
- Nest 生产构建通过。
- Next 生产构建通过，包含 `/admin` 路由。
- 新增/修改的认证文件已通过 Prettier 检查。

当前机器安装的是 pnpm 11，而仓库固定 pnpm 8.15.0。根级 `pnpm lint`、`pnpm test` 和 `pnpm build` 会因既有 `node_modules` 与 pnpm 版本不匹配而在执行任务前中止；不要为了绕过它删除或重建当前依赖目录。若要做完整根级验证，应先在干净环境使用 pnpm 8.15.0 与 lockfile 安装依赖。

后端的 `lint` 脚本带有 `--fix`，不是只读检查；运行前先确认工作区干净，避免意外改写大量 CRLF 文件。

## 当前外部环境阻塞

- 本机没有项目 `.env`，也没有运行 PostgreSQL、Redis、MinIO 或前后端服务。
- `POST /auth/send-code` 仍需要真实 SMTP；当前只完成 mock SMTP 单元测试，登录不能视为端到端验收完成。
- 没有 Provider 配置和真实上游，聊天、生图和管理端尚未做浏览器/API 端到端验证；管理员账户初始化代码已有单元测试，真实数据库记录仍需远程确认。

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

## 随后的开发顺序

1. 建立 PostgreSQL、Redis、MinIO、SMTP mock Provider 的可复现测试环境，补认证、聊天 SSE、生图和管理端的 API/E2E 最小旅程。
2. 在真实环境验收当前管理端的角色边界、余额调整审计、模型/Provider/上游映射的创建与启停。
3. 处理 `docs/known-issues.md` 中的 Provider 固定窗口限流（P-001）和生图恢复后可能重复请求上游（I-001）。
4. 为生产数据库迁移流程建立可验证的 baseline migration，再调整容器启动策略；不要直接替换既有 `db push` 流程。

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
