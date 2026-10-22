# 创蓝短信验证码排障

更新日期：2026-10-22。

## 本次发现

- 只读日志显示 `POST /api/auth/register/send-code` 的 400 对应创蓝 `code=201124 msg=白模板匹配错误`，请求已到达供应商。
- 同一路径的 404 来自 GET 请求。发送接口只接受 POST，浏览器地址栏直接访问不会发送验证码。日志也有一次 POST 200，不能将所有失败归因于路由不存在。
- 只读查询当前启用渠道的模板详情：模板已审核、三网审核通过；模板只有一个 `{s}` 变量，但变量长度为 `4`，文案写“10 分钟”。Lumina 固定生成 6 位数字，Redis 实际 TTL 为 300 秒，必须统一配置。
- 注册和登录的控制器未传 `request.ip`，导致手机号短信请求共享 `unknown` IP 的每小时 30 次限额。现已传入框架解析的客户端 IP；代理信任仍由现有 `TRUST_PROXY` 控制。

## 正确配置

当前 Adapter 对接**统一应用 API Key 模式**。`appId`、`appSecret` 取自“开发者中心 → 统一应用管理 → API Key”，不能替换为独立短信产品的 API 账号和密码。

```json
{
  "appId": "控制台生成的 AppID",
  "appSecret": "控制台生成的 AppSecret",
  "templateCode": "已审核的 verify 模板 ID",
  "endpoint": "https://smssh.253.com"
}
```

模板示例：`您的验证码为 {s}，5 分钟内有效，请勿泄露。`

- 模板必须属于对应 API Key 账号的 `verify` 产品类型。
- 只使用一个验证码变量，允许长度至少为 **6 位**；系统只传入 `param1`，不会填充额外的有效期或产品名变量。
- 固定文案使用 **5 分钟**，与后端的 300 秒 TTL 一致；不要通过缩短或截断生成的验证码适配 4 位模板。
- 在创蓝控制台调整模板后等待审核通过，再将模板 ID 保存到 Lumina 短信渠道中，并执行“验证配置”。本次未修改生产模板或渠道记录。
- `endpoint` 只填写 HTTPS 域名基础地址，不含 `/sms/v2/batch-send`、查询串、用户名或密码。适配器会补上路径；粘贴完整接口地址会被拒绝，避免重复路径产生上游 404。

发送协议保持为 `POST https://smssh.253.com/sms/v2/batch-send`，请求头为 `AppID`、`Nonce`、`CurTime`、`CheckSum`，其中 `CheckSum=SHA1(AppSecret+Nonce+CurTime)`；请求体包含 `productType=verify`、11 位国内手机号、`templateCode` 和 `templateParam` JSON 数组字符串。

管理端“验证配置”只调用 `/sms/v2/template/detail`，验证鉴权、审核状态、验证码变量数量和长度，不发送真实短信。该检查不能证明手机实际收到短信，也不能替代运营商送达回执或真实联调。

官方依据：[统一应用调用说明](https://doc.chuanglan.com/docs/I58861JUE7A3QRU4)、[统一应用短信发送](https://doc.chuanglan.com/docs/4KGLSB1T76BPH1NW)、[统一应用模板管理](https://doc.chuanglan.com/docs/Q0XKFCD6A9R3PKQ2)。独立产品 API 账号模式使用不同的鉴权和参数，不能混用。

## 接口和状态码

| 场景 | 请求 | 结果 |
| --- | --- | --- |
| 注册短信 | `POST /api/auth/register/send-code`，JSON `{"phone":"13800138000"}` | 成功 200 |
| 直连后端 | `POST /auth/register/send-code`，同上 JSON | 成功 200 |
| 地址栏直接打开 | `GET /api/auth/register/send-code` | 404，不发送短信 |
| 手机号或限流校验失败 | 正确的 POST 请求 | 400，显示校验或限流原因 |
| 创蓝模板不兼容、`201124` | 正确的 POST 请求 | 503，`code=SMS_CONFIG_INVALID`，提示联系管理员 |
| 供应商网络或其他发送错误 | 正确的 POST 请求 | 503，`code=SMS_UNAVAILABLE`，提示稍后重试 |
| 管理端验证发现 4 位模板、变量不符 | `POST /api/admin/sms-channels/:id/test` | 400，`INVALID_CHANNEL_CONFIG`，显示具体修正建议 |
| 管理端验证上游请求失败 | 同上 | 502，`CHANNEL_REQUEST_FAILED`，显示诊断原因 |

公开发送接口不会泄露 API Key、上游配置或原始请求。发送失败会删除验证码和冷却状态，允许重试；手机号与 IP 小时限额继续保留。验证码仅在供应商确认提交成功后写入 Redis。

## 验证与部署边界

按“本地提交推送 → `ssh lch` → `/root/lumina` 快进拉取 → 测试”的顺序验证。后端专项覆盖 POST/GET 路由、客户端 IP、4 位模板、无变量/多变量模板、`201124`、安全错误响应、失败清理及重试。

验证结果（短信代码提交 `1f6fdb7`，构建上下文修复 `48bf022`，均先本地推送再远程快进拉取）：

- 远程使用 pnpm 8.15.0：短信专项 3 个套件 / 30 项通过；后端全量 28 个套件 / 150 项通过；共享包、后端和前端构建通过。
- 本次改动后端文件 lint 0 错误、96 项格式警告。全仓后端 lint 存在既有错误：`apps/backend/src/modules/support/support.service.ts:54` 使用 `{}` 类型触发 `@typescript-eslint/ban-types`；未修改无关客服模块。
- 隔离 `lumina-e2e` 使用独立 PostgreSQL / Redis / MinIO 命名卷完成完整 smoke，包括短信注册、密码/验证码登录、手机号绑定、管理端、聊天、生图、对象存储、历史和审计；短信投递使用 Mock，不调用真实发送接口。
- 经前端 `/api` 代理额外验证：注册短信 POST 200、GET 404；专用测试 Redis 中确有 6 位 Mock 验证码。
- 使用本次 TypeScript 适配器只读验证实际创蓝模板，明确返回 `INVALID_CHANNEL_CONFIG`，提示“变量长度为 4 位，Lumina 需要 6 位”；未发送短信、未写入生产数据库。
- 构建时发现 `.dockerignore` 未排除宿主持久化目录，已添加 `postgres_data`、`redis_data`、`minio_data`；专用 Docker 构建检查确认镜像上下文副本不包含这些目录及 `.env`。
- 专用 E2E 容器、网络、数据卷及本次后端/前端测试镜像、上下文检查镜像已清理。生产五个 Lumina 容器的 ID、启动时间和重启次数与验证前一致。

本次仅同步源码并完成隔离验证，**未部署生产容器**。真实短信仍需先在创蓝侧完成 6 位变量 / 5 分钟文案的模板调整与审核，后续在允许部署时更新应用，再进行真实投递与送达验收。
