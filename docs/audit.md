# Lumina 安全审查

- 审查日期为 2026 年 11 月 11 日，基线为 `main` 上的提交 `a741d4d`。
- 范围包括认证与管理权限、支付与钱包、AI 请求与对象存储、生产部署及锁定依赖。
- 若线上仍在运行旧版本且使用了示例凭据，应先轮换并撤销旧会话；旧版本启用易支付 `submit.php` 时，应在升级到带服务端查单校验的版本前停用该模式。

## 第一阶段修复记录（2026 年 11 月 15 日）

- 已实现生产密钥启动校验和 Compose 必填配置；已增加支付、短信与对象存储配置密文的事务式轮换命令。已有生产密钥仍须由运维安全轮换，JWT 更换会撤销现有令牌；数据库密码和管理员现有密码需按[安全配置与轮换](security-operations.md)另行处理。
- 易支付固定下单商品名，拒绝重复、未知或含签名分隔符的回调字段，并校验商户、订单和支付方式；`submit.php` 成功回调必须再经服务端查单确认金额和支付状态。
- 注册只绑定本次验证的邮箱或手机号；服务启动不会自动提升已存在的普通账号，改由受控的 `admin:promote` 命令显式提权。旧数据中无法辨认的未验证邮箱仍需人工核查。
- HTTPS 入口为可选项：默认 HTTP 入口可由外部 TLS 反代接入；也可加载 `docker-compose.https.yml` 启用内置证书和 HTTPS 重定向。
- 按部署要求保留 HTTP 默认入口后，明文风险仍需由外部 TLS 反代和源站访问控制消除；仓库内置 HTTPS 只是可选部署方式。
- 聊天上下文用量查询改为读取模型元数据，不再调用会占用共享上游限额的路由选择。
- 远端验证：提交 `2b135f3` 上 6 个定向测试套件共 66 项全部通过；CLI 执行方式更新后的提交 `ddeee3d` 全量 `tsc --noEmit` 通过。Nest webpack 构建未取得退出结果，远端负载升至较高水平后 SSH 超时；Compose 配置解析也因远端 SSH 超时未完成。恢复部署前应重新构建镜像并确认 Compose 配置。

## 严重

### 生产部署接受公开的默认凭据和配置加密密钥

Compose 为 `JWT_SECRET`、`ADMIN_PASSWORD` 和数据库密码提供已知默认值。保留默认签名密钥时，服务端可能接受冒充已有账号的令牌；首次创建管理员时，默认密码也可用于登录。`.env.example` 还提供公开固定的支付、短信和对象存储配置加密密钥，Compose 只要求它们非空。若直接使用示例值，数据库或备份泄露后，渠道与存储凭据可被离线解密。生产启动应拒绝所有缺失或已知示例凭据。已使用这些值的环境需要轮换 JWT 密钥和管理员密码、撤销旧会话；配置密文须先用旧密钥解密并以新随机密钥重加密，再轮换可能已泄露的支付、短信和对象存储凭据。[数据库默认密码](../docker-compose.yml#L7) · [认证默认值](../docker-compose.yml#L55) · [示例密钥](../.env.example#L54) · [支付与短信示例密钥](../.env.example#L86) · [密钥派生](../apps/backend/src/modules/payments/services/payment-config-crypto.service.ts#L43) · [JWT 校验](../apps/backend/src/modules/auth/strategies/jwt.strategy.ts#L14) · [管理员初始化](../apps/backend/src/modules/users/users.service.ts#L43)

## 高危

### 易支付 `submit.php` 模式存在未付款入账风险

下单会对用户可控的商品名签名，并把签名返回浏览器。回调使用相同密钥和字段边界存在歧义的签名规则，验签后可直接触发充值。应使用服务端固定的商品名、严格校验回调字段，并在入账前独立向渠道核对商户、订单、金额和支付状态。该发现针对 `submit.php` 模式。[下单签名](../apps/backend/src/modules/payments/channels/epay/epay.adapter.ts#L84) · [回调验签](../apps/backend/src/modules/payments/channels/epay/epay.adapter.ts#L163) · [入账逻辑](../apps/backend/src/modules/payments/services/payment.service.ts#L398)

### 注册可预占未验证邮箱，后续管理员初始化可能导致提权

注册只验证所选方式，却同时保存邮箱和手机号。短信注册可占用他人的邮箱，同时保留注册者的密码和短信登录能力。如果这个邮箱后来被配置为 `ADMIN_EMAIL`，启动流程会直接提升现有账号。应逐一验证登录标识再绑定，并使用独立流程创建管理员。[注册](../apps/backend/src/modules/auth/auth.service.ts#L237) · [启动时角色更新](../apps/backend/src/modules/users/users.service.ts#L56)

### 默认部署入口以明文传输登录凭据

Compose 将仅监听 HTTP 的 Nginx 发布到宿主机。客户端可直接访问该端口且没有 TLS 时，密码、验证码和令牌会走明文。应强制公网入口使用 HTTPS，并限制源站端口仅供受信代理访问。[端口发布](../docker-compose.yml#L100) · [Nginx 监听](../nginx/Dockerfile#L7)

### 聊天上下文查询会消耗共享上游配额

普通登录用户查询上下文用量时，无需余额即可占用真实生成请求共用的配额。配额耗尽后，其他用户的聊天请求可能失败。查询应只读取模型元数据，在实际发起上游请求前再占用配额。[上下文查询](../apps/backend/src/modules/chat/chat.service.ts#L247) · [共享配额](../apps/backend/src/modules/providers/providers.service.ts#L492)

## 中危及其他风险

- **微信优惠券支付可能已扣款却无法入账。** 下单使用订单总额 `amount.total`，回调和主动查单却取扣除优惠券后的 `payer_total` 与本地总额比较；使用优惠券时合法成功支付会被拒绝。应以 `amount.total` 核对订单，另存 `payer_total` 用于对账。[下单金额](../apps/backend/src/modules/payments/channels/wechat/wechat.adapter.ts#L91) · [回调金额](../apps/backend/src/modules/payments/channels/wechat/wechat.adapter.ts#L179) · [查单金额](../apps/backend/src/modules/payments/channels/wechat/wechat.adapter.ts#L194) · [本地金额校验](../apps/backend/src/modules/payments/services/payment.service.ts#L537) · [微信支付字段说明](https://pay.wechatpay.cn/doc/v3/merchant/4013070368)
- **微信 API 可能误拒有效的签名响应。** 适配器让 Axios 先解析 JSON，再用 `JSON.stringify(response.data)` 重建报文验签。微信支付要求使用原始响应正文；只要空白、转义或数字格式在重建时变化，正确签名也会验不过，下单和查单等调用可能失败。应保留原始响应字节验签，通过后再解析 JSON。[响应重建](../apps/backend/src/modules/payments/channels/wechat/wechat.adapter.ts#L254) · [微信支付验签规则](https://pay.wechatpay.cn/doc/v3/merchant/4013053420)
- **支付宝回调未核对商户身份。** 验签后仅提取订单号、状态和金额，未核对通知中的 `app_id` 与 `seller_id` 是否属于该订单的收款商户；支付宝官方要求验签后逐项检查。跨商户错认取决于公钥和服务商配置，当前静态审查未证明可直接利用。应在入账前绑定并比对应用和卖家身份。[回调解析](../apps/backend/src/modules/payments/channels/alipay/alipay.adapter.ts#L122) · [支付宝通知校验规则](https://developer.alibaba.com/docs/doc.htm?articleId=106448&docType=1&treeId=204)
- **修改支付渠道配置会影响在途订单对账。** 订单只保存渠道 ID，回调验签和主动查单读取渠道的当前配置。若订单创建后更换商户或密钥，原订单可能无法验签或查询，付款后不能自动入账。应为订单固定配置版本，并保留旧配置直到在途订单结清。[渠道更新](../apps/backend/src/modules/payments/services/payment-channel.service.ts#L74) · [查单与回调](../apps/backend/src/modules/payments/services/payment.service.ts#L334) · [订单结构](../apps/backend/prisma/schema.prisma#L334)
- **钱包入账依赖无续租的 30 秒锁。** 充值和管理员调账读取余额后写入绝对值；如果数据库阻塞或进程暂停超过 Redis 锁期限，后续操作可取得新锁并并发写入，导致一笔余额更新被覆盖。应使用数据库原子增减并维持流水幂等，避免仅靠有时限的进程外锁保证资金正确性。[锁期限](../apps/backend/src/modules/wallet/wallet.service.ts#L77) · [充值写入](../apps/backend/src/modules/wallet/wallet.service.ts#L692) · [管理员调账](../apps/backend/src/modules/wallet/wallet.service.ts#L746)
- **提示词优化的毫秒幂等键可能漏扣并发请求。** 同一用户同毫秒发起的优化请求共用 `prompt-opt:${userId}:${Date.now()}`；钱包将重复预扣与结算视为已完成，但每个请求都会调用上游。应为每次请求生成唯一 ID，并在账本层明确区分重试与独立调用。[键生成与上游调用](../apps/backend/src/modules/image/image.service.ts#L118) · [预扣幂等](../apps/backend/src/modules/wallet/wallet.service.ts#L120) · [结算幂等](../apps/backend/src/modules/wallet/wallet.service.ts#L200)
- **预扣过期后已交付内容可能无法结算。** 钱包预扣在 Redis 中仅保留 10 分钟，过期后 `settle` 直接拒绝。聊天流在预扣后持续向客户端发送内容，直到上游结束才结算；流超过 10 分钟时可能已交付内容却没有收款。应给上游调用设总时长，或使用可续期、可恢复的持久预留和补记流程。[预扣期限](../apps/backend/src/modules/wallet/wallet.service.ts#L73) · [过期拒绝](../apps/backend/src/modules/wallet/wallet.service.ts#L224) · [聊天结算](../apps/backend/src/modules/chat/chat.service.ts#L659)
- **提示词优化扣款后仍可能向用户报失败。** 完成 `settle` 后还要写 Redis 上游状态；若这一步失败，统一异常处理尝试退回已经清理的预扣，向用户返回错误，但账本扣费不变。应隔离非关键的上游状态记录错误，并按持久交易状态进行退款或恢复结果。[扣费与后续操作](../apps/backend/src/modules/image/image.service.ts#L153) · [异常处理](../apps/backend/src/modules/image/image.service.ts#L177) · [退款逻辑](../apps/backend/src/modules/wallet/wallet.service.ts#L307)
- **默认注册赠额可被批量领取。** 生产 Compose 默认给每个新账号 10 光子；邮箱注册没有来源限流或奖励领取主体限制。控制多个邮箱的用户可以重复领取赠额并消耗付费上游配额。应按业务政策限制奖励领取，评估生产默认赠额，并监控新账号的集中消费。[生产默认值](../docker-compose.yml#L65) · [赠额创建](../apps/backend/src/modules/users/users.service.ts#L101) · [注册入口](../apps/backend/src/modules/auth/auth.controller.ts#L83)
- **未支付订单和主动查单缺少请求配额。** 登录用户可不断换 `Idempotency-Key` 创建最低 0.1 元的订单而不付款，再反复同步订单触发渠道查单。全局限流守卫未启用，也没有按账号限制待付订单数或查单频率；大量请求可堆积订单并消耗渠道接口配额。应限制未结订单数和同步频率，并复用短期查单结果。[下单与查单入口](../apps/backend/src/modules/payments/controllers/payments.controller.ts#L33) · [创建订单](../apps/backend/src/modules/payments/services/payment.service.ts#L66) · [主动查单](../apps/backend/src/modules/payments/services/payment.service.ts#L323)
- **邮件验证码可用于枚举账号并批量触发 SMTP。** 登录与注册发码按邮箱存在与否返回不同错误；邮件只按目标邮箱设置冷却，没有按来源和全局邮件量限流。攻击者可轮换邮箱批量触发发送。应统一公开响应，并限制来源与全局邮件配额。[发码入口](../apps/backend/src/modules/auth/auth.controller.ts#L31) · [邮箱检查和冷却](../apps/backend/src/modules/auth/auth.service.ts#L111) · [未挂载的限流模块](../apps/backend/src/app.module.ts#L29)
- **客服实时订阅没有连接数上限。** 任意登录用户可反复开启 SSE，每条连接都会复制独立的 Redis 订阅客户端；单账号堆积长连接可耗尽 Redis 连接和后端句柄。应限制单账号与全局并发连接数，并用共享订阅向连接扇出事件。[订阅入口](../apps/backend/src/modules/support/support.controller.ts#L62) · [Redis 客户端复制](../apps/backend/src/redis/redis.service.ts#L121) · [长连接代理](../nginx/Dockerfile#L30)
- **聊天和生图查询的分页大小没有上限。** 普通用户可传很大的 `limit`，服务直接用于 Prisma 查询；聊天消息还逐条生成对象存储签名 URL。已有较多自身数据的账号可用单请求占用大量查询、内存和签名计算。应给所有分页接口设合理的 `limit` 上限。[聊天 DTO](../apps/backend/src/modules/chat/dto/chat.dto.ts#L26) · [生图 DTO](../apps/backend/src/modules/image/dto/image.dto.ts#L60) · [聊天消息查询](../apps/backend/src/modules/chat/chat.service.ts#L172)
- **登录保护和会话撤销不足。** 全局限流模块未挂载守卫，密码登录可反复尝试。错误验证码会立即作废目标账号当前的验证码。持有有效令牌的人还能凭新手机号的验证码更换短信登录方式，修改密码后旧令牌仍有效。应按账号和来源限流，对验证码失败做原子计数，要求通过现有登录方式重新认证后才能变更凭据，并在变更后撤销旧会话。[限流配置](../apps/backend/src/app.module.ts#L29) · [验证码消费](../apps/backend/src/redis/redis.service.ts#L148) · [手机号绑定](../apps/backend/src/modules/auth/auth.controller.ts#L122) · [JWT 校验](../apps/backend/src/modules/auth/strategies/jwt.strategy.ts#L21)
- **余额不足的账号仍可占用存储和队列。** 聊天在余额检查前保存附件及消息，单次附件上限为 20 MiB。生图在余额检查前保存参考图并入队。创建空聊天会话也没有单账号数量限制。应在持久化和入队前执行配额检查或预留余额，并限制单账号存储量、会话数及待处理任务数。[聊天附件](../apps/backend/src/modules/chat/chat.service.ts#L509) · [生图入队](../apps/backend/src/modules/image/image.service.ts#L231) · [创建会话](../apps/backend/src/modules/chat/chat.service.ts#L55)
- **生图下载和解码缺少响应大小限制。** 如果上游返回的 URL 或重定向可被控制，后端可能访问内网服务，或将超大响应保存为用户可访问的对象。Base64 图片路径同样未限制上游响应体大小，直接解码可能占用大量内存。应限定可信 HTTPS 域名、校验每一跳的目标地址，并限制响应类型和大小；上游 POST 与 Base64 解码也应设置上限。[生图下载](../apps/backend/src/modules/image/image.service.ts#L932) · [Base64 解码](../apps/backend/src/modules/image/image.service.ts#L953)
- **供应商 API Key 明文入库。** 数据库及备份包含原始密钥。仅修改供应商地址时，旧密钥会被保留并用于访问新地址。应使用独立密钥存储，将密钥绑定到上游来源，并在地址变更时要求重新配置密钥。[供应商写入](../apps/backend/src/modules/providers/providers.service.ts#L227) · [配置更新](../apps/backend/src/modules/providers/providers.service.ts#L266)
- **迟到的成功支付回调可能无法入账。** 本地订单过期后会停止查单并拒绝成功回调，即使用户已付款。应使用渠道确认的支付时间，并保留幂等对账及补记或退款路径。[订单查询](../apps/backend/src/modules/payments/services/payment.service.ts#L323) · [入账期限](../apps/backend/src/modules/payments/services/payment.service.ts#L435)
- **上游缺失用量时可能按零费用结算。** 聊天正文已经发送给用户，流式适配器仍可用零用量结束请求；非流式提示词优化也把缺失的 `usage` 记为零，优化结果照常返回。应对已交付内容使用可追溯的估算规则，并持久化需要重试的结算。[流式用量](../apps/backend/src/modules/chat/adapters/openai.adapter.ts#L154) · [聊天结算](../apps/backend/src/modules/chat/chat.service.ts#L669) · [非流式用量](../apps/backend/src/modules/chat/adapters/openai.adapter.ts#L64) · [优化结算](../apps/backend/src/modules/image/image.service.ts#L149)
- **开发 Compose 会向宿主机全部接口发布基础设施端口。** 开发配置把使用示例密码的 PostgreSQL、无密码的 Redis 和 MinIO 映射到 `0.0.0.0`。若开发机可被不可信网络访问，这些服务可被直接连接。应将端口绑定到 `127.0.0.1` 或隔离开发网络。[开发端口](../docker-compose.dev.yml#L14)

## 依赖与验证范围

- 锁文件中的 Next.js `14.2.35` 与生产镜像中的 Node.js 20 均已结束官方支持。应升级到受支持的版本，并在注册表可用时重跑生产依赖审计。[锁文件](../pnpm-lock.yaml#L6735) · [生产镜像](../apps/frontend/Dockerfile#L25) · [Next.js 支持策略](https://nextjs.org/support-policy) · [Node.js 生命周期](https://nodejs.org/en/about/eol)
- 原审查记录显示：前端认证存储功能检查通过；后端 30 套测试中，16 套共 82 项通过，其中支付与钱包 7 套共 47 项通过。其余 14 套因本机 Prisma 生成类型过旧和缺少 bcrypt 原生模块而未运行。本轮未重新运行测试。
- 本轮补充采用静态源码审查，未做线上或真实支付动态验证；锁过期竞态、同毫秒幂等碰撞等条件性路径也未做压力复现。原审查的 `pnpm audit --prod` 因注册表连接失败未完成。
