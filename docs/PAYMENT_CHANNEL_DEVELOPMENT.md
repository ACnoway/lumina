# Lumina 支付渠道模块化开发设计文档

> 适用项目：`ACnoway/lumina`
> 目标版本：支付系统 V1
> 首批内置渠道：易支付、支付宝官方、微信支付官方
> 设计目标：多渠道并存、统一内部接口、低耦合、强幂等、方便后续扩展

## 1. 背景

Lumina 当前后端采用 NestJS + TypeScript + Prisma + PostgreSQL，业务代码以 NestJS Module 为边界，已经包含 `wallet` 钱包/账本模块以及 `providers` 上游供应商模块。当前钱包表使用 `Decimal(18,6)` 保存光子余额，`WalletTransaction` 已提供唯一 `idempotencyKey`，`WalletService.recharge()` 接收的也是已经换算好的光子数量。

### 货币边界

Lumina 的内部平台货币是光子，钱包、账本、模型售价、聊天费用和生图费用全部使用光子。人民币只存在于外部充值/支付订单：支付订单记录用户实际支付的人民币金额，创建订单时读取后台汇率 `1 人民币 = N 光子` 并保存本次应入账的光子快照。支付成功回调不能重新读取最新汇率，也不能把人民币金额直接传给钱包；必须使用订单快照调用 `WalletService.recharge()`。

项目现有 `providers` 模块支持多实例路由，但支付渠道采用不同策略：渠道实例可以同时存在，启用后展示给用户，由用户明确选择具体渠道，不做支付渠道的自动优先级或权重路由。

支付模块应沿用这一思想，但不要把支付代码直接写入 `wallet` 模块。职责应明确区分：

```
payments
    负责：支付渠道、支付订单、签名、验签、回调、订单查询

wallet
    负责：用户余额、充值入账、消费、退款、账本

admin
    负责：渠道配置管理界面/API

frontend
    负责：选择渠道、展示二维码/跳转支付页面、轮询支付状态
```

支付成功以后，`payments` 只通过 `WalletService` 完成余额入账，不直接修改钱包数据库。

# 2. 核心设计原则

## 2.1 Adapter 模式

参考 new-api 对不同上游的处理方式，所有支付渠道必须实现统一的 Adapter，上层 PaymentService 禁止出现：

```
if (channel.type === 'EPAY') {
  ...
} else if (channel.type === 'ALIPAY') {
  ...
} else if (channel.type === 'WECHAT') {
  ...
}
```

new-api 本身通过统一 `Adaptor` 接口定义请求转换、请求发送、响应处理以及渠道元数据，不同上游独立实现；支付模块采用相同的抽象思想。

正确结构：

```
PaymentService
      │
      ▼
PaymentAdapterRegistry
      │
      ├── EPAY ──────── EpayPaymentAdapter
      ├── ALIPAY ────── AlipayPaymentAdapter
      └── WECHAT ────── WechatPaymentAdapter
```

以后新增 Stripe、PayPal、USDT 等渠道时，核心订单业务不需要修改。

# 3. 一个非常重要的概念：Adapter 与 Channel Instance 分离

不能设计成：

```
EPAY
ALIPAY
WECHAT
```

三个固定配置。

必须分为：

```
Adapter Type
    EPAY
    ALIPAY
    WECHAT

Channel Instance
    易支付-A     -> EPAY
    易支付-B     -> EPAY
    支付宝官方-A -> ALIPAY
    微信支付-A   -> WECHAT
```

也就是说：

**Adapter Type 表示协议实现。**

**PaymentChannel 表示一个真实商户配置实例。**

这样管理员可以同时启用：

```
易支付 A       enabled
易支付 B       enabled
支付宝官方     enabled
微信支付官方   enabled
```

甚至可以同时配置两个支付宝商户。

# 4. 推荐目录结构

```
apps/backend/src/modules/payments/
├── payments.module.ts
│
├── controllers/
│   ├── payments.controller.ts
│   ├── payment-notify.controller.ts
│   └── admin-payment-channels.controller.ts
│
├── services/
│   ├── payment.service.ts
│   ├── payment-channel.service.ts
│   ├── payment-router.service.ts
│   └── payment-config-crypto.service.ts
│
├── core/
│   ├── payment-channel.adapter.ts
│   ├── payment-adapter.registry.ts
│   ├── payment.types.ts
│   ├── payment.errors.ts
│   └── payment.constants.ts
│
├── channels/
│   ├── epay/
│   │   ├── epay.adapter.ts
│   │   ├── epay.types.ts
│   │   ├── epay.sign.ts
│   │   └── epay.config.ts
│   │
│   ├── alipay/
│   │   ├── alipay.adapter.ts
│   │   ├── alipay.types.ts
│   │   └── alipay.config.ts
│   │
│   └── wechat/
│       ├── wechat.adapter.ts
│       ├── wechat.types.ts
│       ├── wechat.crypto.ts
│       └── wechat.config.ts
│
├── dto/
│   ├── create-payment.dto.ts
│   ├── payment-order.dto.ts
│   └── payment-channel.dto.ts
│
└── utils/
    ├── money.ts
    └── order-no.ts
```

前后端共享枚举和响应类型建议放：

```
packages/shared/src/payment/
```

# 5. 内部统一支付接口

核心接口建议定义为：

```
export interface PaymentChannelAdapter<TConfig = unknown> {
  /**
   * Adapter 唯一类型
   */
  readonly type: PaymentChannelType;

  /**
   * Adapter 展示信息及能力
   */
  getMetadata(): PaymentChannelMetadata;

  /**
   * 检查管理员填写的配置是否合法
   */
  validateConfig(config: TConfig): Promise<void>;

  /**
   * 创建支付
   */
  createPayment(
    context: PaymentContext,
    request: PaymentCreateRequest,
    config: TConfig,
  ): Promise<PaymentCreateResult>;

  /**
   * 验证并解析异步通知。
   *
   * Adapter 内部负责：
   * - 验签
   * - 解密
   * - 字段转换
   *
   * 返回统一格式。
   */
  parseNotification(
    request: PaymentNotificationRequest,
    config: TConfig,
  ): Promise<PaymentNotification>;

  /**
   * 返回该渠道要求的回调响应。
   */
  buildNotificationResponse(success: boolean): PaymentNotifyResponse;

  /**
   * 主动查询订单。
   */
  queryPayment?(
    request: PaymentQueryRequest,
    config: TConfig,
  ): Promise<PaymentQueryResult>;

  /**
   * 关闭未支付订单。
   */
  closePayment?(
    request: PaymentCloseRequest,
    config: TConfig,
  ): Promise<void>;

  /**
   * 预留退款能力。
   */
  refund?(
    request: PaymentRefundRequest,
    config: TConfig,
  ): Promise<PaymentRefundResult>;
}
```

# 6. Adapter 能力声明

不同渠道支持的支付场景不同，因此不能要求前端直接判断 Adapter 类型。

定义：

```
export interface PaymentChannelMetadata {
  type: PaymentChannelType;
  name: string;

  methods: PaymentMethod[];

  scenes: PaymentScene[];

  capabilities: {
    query: boolean;
    close: boolean;
    refund: boolean;
  };
}
```

枚举：

```
export enum PaymentChannelType {
  EPAY = 'EPAY',
  ALIPAY = 'ALIPAY',
  WECHAT = 'WECHAT',
}

export enum PaymentMethod {
  ALIPAY = 'ALIPAY',
  WECHAT = 'WECHAT',
}

export enum PaymentScene {
  WEB = 'WEB',
  H5 = 'H5',
  QR = 'QR',
  JSAPI = 'JSAPI',
  APP = 'APP',
}
```

注意：

`PaymentChannelType` 是“谁提供接口”。

`PaymentMethod` 是“用户使用什么付款”。

因此易支付可能同时支持：

```
EPAY + ALIPAY
EPAY + WECHAT
```

这是两个不同维度，不能合并成一个 enum。

# 7. 统一支付结果

各家接口返回形式完全不同：

支付宝可能返回支付 URL 或 HTML Form。

微信 Native 返回 `code_url`。

微信 H5 返回跳转 URL。

JSAPI 返回一组前端调起参数。

易支付可能返回二维码，也可能返回收银台地址。

因此统一返回：

```
export type PaymentAction =
  | {
      type: 'REDIRECT_URL';
      url: string;
    }
  | {
      type: 'HTML_FORM';
      html: string;
    }
  | {
      type: 'QR_CODE';
      content: string;
    }
  | {
      type: 'JSAPI';
      params: Record<string, string>;
    }
  | {
      type: 'NONE';
    };

export interface PaymentCreateResult {
  providerTradeNo?: string;

  action: PaymentAction;

  raw?: Record<string, unknown>;
}
```

PaymentController 永远只认识这个结构。

前端同样只需要：

```
switch (action.type) {
  case 'REDIRECT_URL':
  case 'HTML_FORM':
  case 'QR_CODE':
  case 'JSAPI':
}
```

不需要知道当前到底是易支付还是微信支付。

# 8. Adapter Registry

实现：

```
@Injectable()
export class PaymentAdapterRegistry {
  private readonly adapters = new Map<
    PaymentChannelType,
    PaymentChannelAdapter
  >();

  constructor(
    epay: EpayPaymentAdapter,
    alipay: AlipayPaymentAdapter,
    wechat: WechatPaymentAdapter,
  ) {
    this.register(epay);
    this.register(alipay);
    this.register(wechat);
  }

  private register(adapter: PaymentChannelAdapter) {
    if (this.adapters.has(adapter.type)) {
      throw new Error(
        `Duplicate payment adapter: ${adapter.type}`,
      );
    }

    this.adapters.set(adapter.type, adapter);
  }

  get(type: PaymentChannelType): PaymentChannelAdapter {
    const adapter = this.adapters.get(type);

    if (!adapter) {
      throw new UnsupportedPaymentChannelError(type);
    }

    return adapter;
  }

  getAll() {
    return [...this.adapters.values()];
  }
}
```

以后新增渠道的标准流程应该只有：

```
1. 新建 channels/xxx
2. 实现 PaymentChannelAdapter
3. 注册到 PaymentAdapterRegistry
4. 增加 enum
5. 增加配置 DTO / 管理端表单
6. 编写 Adapter Contract Test
```

PaymentService、WalletService 和用户支付 API 不需要修改。

# 9. 数据库设计

## PaymentChannel

推荐增加：

```
model PaymentChannel {
  id          String             @id @default(cuid())

  name        String
  type        PaymentChannelType

  isActive    Boolean            @default(true)

  // 非敏感配置
  publicConfig Json?

  // 加密后的真实商户配置
  configEncrypted String         @db.Text

  configVersion Int              @default(1)

  orders      PaymentOrder[]

  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@index([type])
  @@index([isActive])
  @@map("payment_channels")
}
```

不要直接这样保存：

```
{
  "merchantId": "123",
  "secret": "abcdef",
  "privateKey": "-----BEGIN PRIVATE KEY-----"
}
```

数据库泄漏以后会直接导致商户密钥全部泄漏。

建议增加：

```
PAYMENT_CONFIG_ENCRYPTION_KEY=
```

由：

```
PaymentConfigCryptoService
```

使用 AES-256-GCM 对完整配置 JSON 加密。

管理员查询渠道时只返回脱敏数据，例如：

```
{
  "mchId": "1900****123",
  "privateKeyConfigured": true,
  "apiV3KeyConfigured": true
}
```

# 10. PaymentOrder

```
model PaymentOrder {
  id                String             @id @default(cuid())

  orderNo           String             @unique

  userId            String
  user              User               @relation(fields: [userId], references: [id])

  channelId         String
  channel           PaymentChannel     @relation(fields: [channelId], references: [id])

  channelType       PaymentChannelType

  paymentMethod     PaymentMethod
  scene             PaymentScene

  amount            Decimal            @db.Decimal(10, 2)
  currency          String             @default("CNY")
  photonAmount      Decimal            @db.Decimal(18, 6)
  photonPerCny      Decimal            @db.Decimal(18, 6)

  subject           String

  status            PaymentOrderStatus @default(CREATED)

  providerTradeNo   String?

  paidAmount        Decimal?           @db.Decimal(10, 2)
  paidAt            DateTime?

  expireAt          DateTime?

  clientIp          String?

  idempotencyKey    String?

  metadata          Json?

  failureCode       String?
  failureMessage    String?

  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  @@unique([userId, idempotencyKey])
  @@index([userId])
  @@index([channelId])
  @@index([status])
  @@index([providerTradeNo])
  @@index([createdAt])
  @@map("payment_orders")
}
```

状态：

```
enum PaymentOrderStatus {
  CREATED
  PENDING
  SUCCEEDED
  FAILED
  CLOSED
  EXPIRED
  REFUNDED
}
```

# 11. 为什么 PaymentOrder 必须独立存在

不能只靠：

```
WalletTransaction
```

作为支付订单。

两者意义完全不同：

```
PaymentOrder
= 外部支付系统订单

WalletTransaction
= Lumina 内部资金账本
```

一笔支付成功，业务链路是：

```
PaymentOrder
    │
    │ verified callback
    ▼
WalletService.recharge()
    │
    ▼
WalletTransaction(RECHARGE)
```

这样才能处理：

```
支付未完成
支付过期
支付失败
重复通知
主动查询
支付宝已付款但钱包入账失败
退款
对账
```

# 12. 用户表关系

`User` 增加：

```
paymentOrders PaymentOrder[]
```

# 13. 回调事件表

建议增加：

```
model PaymentCallbackEvent {
  id              String   @id @default(cuid())

  channelId       String

  orderNo         String?

  eventKey        String

  signatureValid  Boolean

  processed       Boolean  @default(false)

  payloadHash     String

  errorMessage    String?

  createdAt       DateTime @default(now())
  processedAt     DateTime?

  @@unique([channelId, eventKey])
  @@index([orderNo])
  @@index([createdAt])
  @@map("payment_callback_events")
}
```

目的：

```
回调审计
重复通知识别
问题排查
对账
攻击检测
```

不建议永久保存完整敏感回调原文。

可保存：

```
payload hash
关键字段
脱敏 payload
```

# 14. 金额规范

这是支付模块必须强制执行的规则。

禁止：

```
const amount = 0.1 + 0.2;
```

禁止使用 JS `number` 进行实际资金运算。

内部统一使用 Prisma Decimal：

```
new Decimal('10.00')
```

API 建议金额传字符串：

```
{
  "amount": "10.00"
}
```

支付宝/易支付：

```
10.00 元
```

微信：

```
1000 分
```

转换必须通过统一工具：

```
yuanToFen(amount: Decimal): number
fenToYuan(amount: number): Decimal
```

并强制金额最多两位小数。

# 15. 支付渠道选择

支付渠道不使用 `priority` 或 `weight`，也不由后端自动选择。多个启用的渠道实例会展示给用户，用户在前台选择具体的 `channelId`。

支付和 AI 上游还有一个非常重要的区别：

**支付创建订单以后不能随意自动故障转移。**

例如：

```
向支付宝提交订单
↓
请求超时
↓
Lumina 不知道支付宝到底有没有创建成功
```

此时绝不能直接再向易支付创建另一笔订单。

否则可能出现：

```
支付宝订单可以付款
+
易支付订单也可以付款
```

用户可能重复付款。

因此支付订单创建接口必须收到明确的 `channelId`。后端只负责校验渠道存在、已启用、支持请求的支付方式和场景；渠道请求一旦发送出去，对“不确定结果”的请求禁止透明 failover。

# 16. 渠道选择逻辑

用户必须显式指定：

```
{
  "channelId": "xxx"
}
```

前端先调用：

```
GET /payments/channels?paymentMethod=ALIPAY&scene=QR
```

接口只返回启用且支持该方式/场景的渠道实例，前端展示名称并让用户选择。

# 17. 创建支付 API

用户接口：

```
POST /payments/orders
Authorization: Bearer xxx
Idempotency-Key: xxx
```

请求：

```
{
  "amount": "50.00",
  "paymentMethod": "ALIPAY",
  "scene": "QR",
  "channelId": "channel-instance-id"
}
```

返回：

```
{
  "orderNo": "LM202609191234567890",
  "status": "PENDING",

  "channel": {
    "id": "xxx",
    "name": "支付宝官方"
  },

  "action": {
    "type": "QR_CODE",
    "content": "https://..."
  },

  "expireAt": "2026-09-19T..."
}
```

# 18. 创建订单完整流程

```
Client
  │
  │ POST /payments/orders
  ▼
PaymentController
  │
  ▼
PaymentService.createPayment()
  │
  ├─ 校验金额
  ├─ 校验 Idempotency-Key
  │
  ▼
PaymentChannelService
  │
  └─ 校验指定 channelId、支付方式和场景
  │
  ▼
创建 PaymentOrder(CREATED)
  │
  ▼
PaymentAdapterRegistry.get(channel.type)
  │
  ▼
adapter.createPayment()
  │
  ├─ EPAY
  ├─ ALIPAY
  └─ WECHAT
  │
  ▼
PaymentCreateResult
  │
  ▼
PaymentOrder -> PENDING
  │
  ▼
返回 PaymentAction
```

创建订单只创建支付订单并发起渠道下单，绝不能调用 `WalletService.recharge()`。订单必须经历：

```
CREATED/PENDING
  -> 渠道验签成功的支付通知，或服务端可信查单明确返回已支付
  -> 校验本地订单、渠道、币种和金额
  -> WalletService.recharge（payment:recharge:<orderNo>）
  -> SUCCEEDED
```

前端轮询只能读取订单状态，不得把浏览器请求作为入账触发器。

# 19. 支付成功绝不能依赖前端跳转

必须明确：

```
return_url ≠ 支付成功
```

用户浏览器跳回：

```
https://lumina.example.com/payment/result
```

只能用于页面展示。

绝对禁止：

```
访问 return_url
↓
给钱包加钱
```

钱包充值只允许由：

```
经过验签的异步通知
```

或者：

```
服务端主动查询支付平台确认成功
```

触发。

# 20. 回调 API

统一：

```
/payment/notify/:channelId
```

推荐实际路径：

```
/payments/notify/:channelId
```

例如：

```
/payments/notify/cmxxxxx
```

如果前端通过 Nginx 以 `/api/` 代理后端，`PAYMENT_NOTIFY_BASE_URL` 必须配置为包含
该前缀的公网地址（例如 `https://lumina.example.com/api`），最终回调地址才会是
`https://lumina.example.com/api/payments/notify/:channelId`。不能使用只指向前端页面
的裸域名，否则渠道通知会命中前端而不是后端回调控制器。

为什么 URL 包含 `channelId`：

因为系统允许：

```
支付宝商户 A
支付宝商户 B
```

两个实例。

收到回调以后必须先知道应该使用哪套密钥验签。

# 21. 回调统一结构

Adapter 最终必须转换成：

```
export interface PaymentNotification {
  eventId: string;

  orderNo: string;

  providerTradeNo?: string;

  status:
    | 'SUCCESS'
    | 'PENDING'
    | 'CLOSED'
    | 'FAILED';

  amount?: string;

  currency?: string;

  paidAt?: Date;

  raw?: Record<string, unknown>;
}
```

PaymentService 不允许读取：

```
trade_status
trade_state
transaction_id
trade_no
```

这些全部属于 Adapter 内部实现。

# 22. 回调处理流程

```
支付平台
   │
   ▼
PaymentNotifyController
   │
   ▼
读取 channelId
   │
   ▼
读取 PaymentChannel
   │
   ▼
PaymentAdapterRegistry
   │
   ▼
adapter.parseNotification()
   │
   ├─ 验签
   ├─ 解密
   └─ 转换统一结构
   │
   ▼
PaymentService.processNotification()
```

然后执行：

```
查询 orderNo
↓
验证 channelId 一致
↓
验证金额一致
↓
验证币种
↓
检查订单状态
↓
SUCCESS？
↓
WalletService.recharge()
↓
PaymentOrder -> SUCCEEDED
↓
返回渠道要求的 ACK
```

# 23. 最关键的充值幂等设计

Lumina 当前 `WalletService.recharge()` 已经支持 `idempotencyKey`，应直接利用这一能力。

支付充值固定生成：

```
const walletIdempotencyKey =
  `payment:recharge:${paymentOrder.orderNo}`;
```

调用：

```
// 创建支付订单时已按当时汇率计算并保存 photonAmount；回调只读取订单快照。
const photonAmount = order.photonAmount;

await walletService.recharge(
  order.userId,
  photonAmount,
  `支付充值 ${order.orderNo}`,
  `payment:recharge:${order.orderNo}`,
);
```

即使：

```
支付宝通知 10 次
微信通知 5 次
易支付通知重复
管理员手动重新处理
主动对账再次发现成功
```

最终也只能生成一条 RECHARGE。

# 24. 推荐的成功处理顺序

推荐：

```
1. 验签

2. 验证订单和金额

3. WalletService.recharge(
      idempotencyKey = payment:recharge:{orderNo}
   )

4. PaymentOrder -> SUCCEEDED

5. 返回 success ACK
```

为什么钱包充值放在状态更新之前：

假设：

```
钱包充值成功
↓
数据库更新 PaymentOrder 失败
```

这时向支付平台返回失败。

支付平台再次通知：

```
WalletService.recharge()
```

因为幂等键一样，不会重复充值。

然后再次尝试：

```
PaymentOrder -> SUCCEEDED
```

这样比先标记 SUCCEEDED 再充值安全。

# 25. 状态只能单向推进

基本规则：

```
CREATED
   ↓
PENDING
   ↓
SUCCEEDED
```

或者：

```
CREATED -> FAILED

PENDING -> CLOSED

PENDING -> EXPIRED
```

一旦：

```
SUCCEEDED
```

禁止因为后续异常通知修改成：

```
FAILED
CLOSED
EXPIRED
```

支付成功属于终态。

# 26. 易支付 Adapter

V1 首先兼容最常见的易支付协议。

常见 V1 接口包括：

```
/submit.php
/mapi.php
/api.php
```

请求通常采用 `application/x-www-form-urlencoded`，字段包括：

```
pid
type
out_trade_no
notify_url
return_url
name
money
sign
sign_type
```

V1 常见签名方式是排除 `sign`、`sign_type` 与空值后按参数名 ASCII 排序，将参数拼接后追加商户 KEY，再进行 MD5。异步通知通常通过 `trade_status=TRADE_SUCCESS` 表示成功，并要求商户返回 `success`。不同易支付实现存在一定差异，因此协议细节必须全部收敛在 Adapter 内，而不能泄露到 PaymentService。

易支付查单接口通常同时返回接口调用结果和订单状态。`code=1` 只表示查单请求成功，
不代表订单已经支付；必须读取 `trade_status` 或供应商明确约定的订单状态字段。只有
明确的已支付状态才能返回统一 `SUCCESS`，`status=0`、缺失状态和未知状态都必须
保持 `PENDING`，避免创建订单后的首次轮询误充值。

配置：

```
export interface EpayConfig {
  baseUrl: string;

  pid: string;

  key: string;

  protocolVersion: 'V1';

  signType: 'MD5';

  supportedTypes?: {
    alipay?: boolean;
    wxpay?: boolean;
  };
}
```

后面如果增加易支付 V2：

```
protocolVersion: 'V2'
signType: 'RSA'
```

无需修改 PaymentService。

部分易支付平台已经存在 RSA/SHA256WithRSA 的 V2 协议，因此提前保留 `protocolVersion` 是有必要的。

# 27. 易支付 createPayment

映射：

```
PaymentMethod.ALIPAY
    -> type=alipay

PaymentMethod.WECHAT
    -> type=wxpay
```

参数：

```
pid
type
out_trade_no
notify_url
return_url
name
money
clientip
sign
sign_type
```

如果调用：

```
mapi.php
```

返回二维码，则：

```
{
  action: {
    type: 'QR_CODE',
    content: response.qrcode,
  }
}
```

如果使用：

```
submit.php
```

则：

```
{
  action: {
    type: 'REDIRECT_URL',
    url,
  }
}
```

# 28. 支付宝官方 Adapter

建议使用支付宝官方 Node.js SDK：

```
alipay-sdk
```

官方 SDK 已经提供：

```
签名
验签
OpenAPI 请求
pageExecute
```

并支持电脑网站支付等场景。

配置：

```
export interface AlipayConfig {
  appId: string;

  privateKey: string;

  alipayPublicKey: string;

  gateway?: string;

  sandbox?: boolean;
}
```

首批建议支持三个场景：

```
WEB
    alipay.trade.page.pay

H5
    alipay.trade.wap.pay

QR
    alipay.trade.precreate
```

支付宝官方 SDK 的 `pageExecute()` 可以生成网站支付 URL 或 HTML Form，而统一收单接口还包括 `trade.query`、`trade.precreate`、`trade.refund` 等能力。

Adapter 统一转换为：

```
page.pay
    -> REDIRECT_URL / HTML_FORM

wap.pay
    -> REDIRECT_URL / HTML_FORM

precreate
    -> QR_CODE
```

回调验签全部由 AlipayAdapter 完成。

# 29. 微信支付官方 Adapter

统一使用：

```
微信支付 API v3
```

不要再开发新的 API v2 实现。

微信支付 API v3 使用非对称签名；支付回调中的敏感资源使用 APIv3 Key 进行 AES-256-GCM 解密，官方 SDK也将“请求签名、响应验签、回调验签和解密”作为基础能力。

配置：

```
export interface WechatPayConfig {
  appId: string;

  mchId: string;

  merchantSerialNo: string;

  merchantPrivateKey: string;

  apiV3Key: string;

  wechatPayPublicKey?: string;

  wechatPayPublicKeyId?: string;
}
```

首批建议支持：

```
QR
    Native

H5
    H5

JSAPI
    JSAPI
```

微信 API v3 的 H5 下单 URI 为：

```
POST /v3/pay/transactions/h5
```

JSAPI 使用：

```
POST /v3/pay/transactions/jsapi
```

Native 同样属于 API v3 基础支付产品。

统一转换：

```
Native
    code_url
    ->
    QR_CODE

H5
    h5_url
    ->
    REDIRECT_URL

JSAPI
    prepay_id
    ->
    JSAPI
```

# 30. 微信回调特别要求

WechatAdapter 内部负责：

```
读取 HTTP Headers
↓
验证微信支付签名
↓
读取 body
↓
AES-256-GCM 解密 resource
↓
读取 out_trade_no
↓
读取 transaction_id
↓
读取 trade_state
↓
统一转换 PaymentNotification
```

PaymentService 不应该知道：

```
Wechatpay-Signature
Wechatpay-Serial
resource.ciphertext
resource.nonce
```

# 31. NestJS Raw Body

当前 Lumina：

```
NestFactory.create(AppModule)
```

尚未开启 raw body。

支付回调签名往往需要原始请求内容，因此建议调整：

```
const app = await NestFactory.create(AppModule, {
  rawBody: true,
});
```

Notification Controller 获取原始数据，不要：

```
JSON parse
↓
JSON stringify
↓
再验签
```

因为字节变化可能导致签名验证失败。

# 32. 支付渠道管理 API

管理员接口建议：

```
GET
/admin/payment-channels/adapters
```

返回系统支持：

```
[
  {
    "type": "EPAY",
    "name": "易支付"
  },
  {
    "type": "ALIPAY",
    "name": "支付宝官方"
  },
  {
    "type": "WECHAT",
    "name": "微信支付官方"
  }
]
```

渠道 CRUD：

```
GET    /admin/payment-channels

POST   /admin/payment-channels

GET    /admin/payment-channels/:id

PATCH  /admin/payment-channels/:id

POST   /admin/payment-channels/:id/enable

POST   /admin/payment-channels/:id/disable

POST   /admin/payment-channels/:id/test
```

不建议实际 DELETE。

历史 PaymentOrder 需要继续引用原渠道。

使用：

```
isActive=false
```

即可。

# 33. Adapter 配置验证

创建渠道：

```
POST /admin/payment-channels
```

之前必须：

```
adapter.validateConfig(config)
```

例如：

### EPAY

检查：

```
baseUrl
pid
key
```

可以调用商户查询接口验证。

### Alipay

检查：

```
appId
privateKey
alipayPublicKey
```

同时尝试初始化官方 SDK。

### WeChat

检查：

```
mchId
appId
serialNo
privateKey
apiV3Key
```

可通过订单查询/证书相关能力确认基础签名是否工作。

# 34. 用户获取支付渠道

```
GET /payments/channels
```

可传：

```
paymentMethod
scene
```

例如：

```
GET /payments/channels?paymentMethod=ALIPAY&scene=QR
```

返回：

```
[
  {
    "id": "xxx",
    "name": "支付宝官方",
    "paymentMethod": "ALIPAY"
  },
  {
    "id": "yyy",
    "name": "易支付",
    "paymentMethod": "ALIPAY"
  }
]
```

不得返回：

```
pid
key
appId
privateKey
mchId
```

等内部配置。

# 35. 查询订单

用户：

```
GET /payments/orders/:orderNo
```

返回：

```
{
  "orderNo": "...",
  "amount": "50.00",
  "status": "SUCCEEDED",
  "paymentMethod": "ALIPAY",
  "createdAt": "...",
  "paidAt": "..."
}
```

必须验证：

```
order.userId === currentUser.id
```

管理员才允许查看所有订单。

# 36. 主动查询支付平台

推荐增加：

```
POST /payments/orders/:orderNo/sync
```

或者内部 Service：

```
paymentService.syncOrder(orderNo)
```

执行：

```
adapter.queryPayment()
```

主要解决：

```
支付成功
但回调暂时没有收到
```

的情况。

主动查询发现成功以后，仍然进入同一个：

```
processPaymentSuccess()
```

不能另外写一套充值逻辑。

查单响应中的接口级 `code` 只表示查单请求是否成功，不表示订单已经付款。Adapter
必须只把渠道协议明确的已支付状态（例如 `TRADE_SUCCESS`、`TRADE_FINISHED`，或
该渠道明确约定的数值已支付状态）映射为 `SUCCESS`；缺失、未知或未支付状态一律
映射为 `PENDING`。`code=1` 单独出现时绝不能入账。

# 37. 统一支付成功入口

建议：

```
private async processPaymentSuccess(
  order: PaymentOrder,
  result: ConfirmedPayment,
) {
  // validate amount

  await this.walletService.recharge(
    order.userId,
    Number(order.photonAmount),
    `支付充值 ${order.orderNo}`,
    `payment:recharge:${order.orderNo}`,
  );

  await this.prisma.paymentOrder.updateMany({
    where: {
      id: order.id,
      status: {
        not: 'SUCCEEDED',
      },
    },
    data: {
      status: 'SUCCEEDED',
      paidAt: result.paidAt ?? new Date(),
      paidAmount: result.amount,
      providerTradeNo:
        result.providerTradeNo,
    },
  });
}
```

这样：

```
异步通知
主动查询
人工补单
对账任务
```

最后都走同一个成功处理路径。

# 38. 支付订单号

不要直接使用：

```
userId
cuid
数据库自增ID
```

作为第三方商户订单号。

建议：

```
LM{yyyyMMddHHmmss}{random}
```

例如：

```
LM2026091914063512345678
```

要求：

```
全局唯一
不泄露用户 ID
仅数字/ASCII
长度兼容各渠道要求
```

数据库仍然保留自己的 `id=cuid()`。

# 39. Idempotency-Key

用户可能：

```
双击充值
网络重试
浏览器自动重发
```

所以创建支付订单也必须支持幂等。

例如：

```
Idempotency-Key:
recharge-550e8400-e29b-41d4-a716
```

数据库：

```
@@unique([userId, idempotencyKey])
```

同一个用户使用相同 Key：

```
第一次：
创建订单

第二次：
直接返回第一次的 PaymentOrder
```

不得创建第二个第三方订单。

# 40. 安全规范

支付模块必须满足：

```
私钥禁止写日志

merchant key 禁止写日志

APIv3 Key 禁止写日志

完整回调原文默认禁止长期保存

管理员 API 返回配置必须脱敏

通知接口不使用 JWT

通知接口必须使用渠道签名验证

通过商户密钥完成的服务端查单兜底必须在审计中标记为“查单确认”，不能记录为签名回调。

金额以服务端 PaymentOrder 为准

客户端不能指定 paidAmount

return_url 不能改变订单状态

支付成功必须检查金额一致

支付成功必须检查币种一致，且金额和币种字段都必须存在；字段缺失时拒绝入账。

支付成功必须检查 channelId 一致

支付成功必须检查商户订单号存在
```

尤其禁止：

```
if (notify.trade_status === 'SUCCESS') {
  // 先校验本地 PaymentOrder，再使用订单保存的 photonAmount 入账。
}
```

必须：

```
根据 out_trade_no 查询本地订单
↓
本地 amount == 平台 amount
↓
才能充值
```

# 41. 错误模型

统一：

```
export enum PaymentErrorCode {
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',

  CHANNEL_DISABLED = 'CHANNEL_DISABLED',

  UNSUPPORTED_PAYMENT_METHOD =
    'UNSUPPORTED_PAYMENT_METHOD',

  UNSUPPORTED_PAYMENT_SCENE =
    'UNSUPPORTED_PAYMENT_SCENE',

  INVALID_CHANNEL_CONFIG =
    'INVALID_CHANNEL_CONFIG',

  CHANNEL_REQUEST_FAILED =
    'CHANNEL_REQUEST_FAILED',

  CHANNEL_REQUEST_TIMEOUT =
    'CHANNEL_REQUEST_TIMEOUT',

  SIGNATURE_INVALID =
    'SIGNATURE_INVALID',

  PAYMENT_ORDER_NOT_FOUND =
    'PAYMENT_ORDER_NOT_FOUND',

  PAYMENT_AMOUNT_MISMATCH =
    'PAYMENT_AMOUNT_MISMATCH',

  PAYMENT_ALREADY_CLOSED =
    'PAYMENT_ALREADY_CLOSED',
}
```

禁止把支付宝、微信的原始错误直接传给 Controller。

Adapter：

```
第三方错误
↓
PaymentChannelError
↓
PaymentService
↓
统一 HTTP 错误
```

原始错误只进入内部日志，并进行敏感字段过滤。

# 42. Logging

日志统一携带：

```
orderNo
channelId
channelType
providerTradeNo
```

例如：

```
payment.create.start

payment.create.success

payment.create.failed

payment.notify.received

payment.notify.signature_invalid

payment.notify.success

payment.wallet.credit.success
```

禁止记录：

```
privateKey
merchantSecret
apiV3Key
完整 Authorization
```

# 43. 测试规范

任何 Adapter 必须经过一套统一 Contract Test。

至少覆盖：

```
注册成功

配置验证

创建订单

金额转换

签名正确

签名错误

回调验签

篡改回调

重复回调

错误金额

错误 orderNo

渠道被禁用

同类型多实例

相同通知多次不重复充值

支付成功后不能回退状态

支付创建超时不会自动创建第二渠道订单
```

# 44. 易支付测试

额外覆盖：

```
MD5 参数排序

空值排除

sign 排除

sign_type 排除

alipay -> type=alipay

wechat -> type=wxpay

TRADE_SUCCESS

查单 `code=1 + 未支付状态` 保持 `PENDING`

查单缺少订单状态保持 `PENDING`

查单明确已支付状态才返回 `SUCCESS`

notify 返回 success
```

# 45. 支付宝测试

覆盖：

```
RSA2 验签

page.pay

wap.pay

precreate

trade.query

错误 appId

错误支付宝公钥

TRADE_SUCCESS

重复通知
```

# 46. 微信测试

覆盖：

```
API v3 请求签名

响应验签

回调签名

AES-256-GCM 解密

Native

H5

JSAPI

SUCCESS

人民币支付金额与光子入账转换

重复通知
```

# 47. PaymentsModule

最终：

```
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    WalletModule,
    AuditModule,
  ],

  controllers: [
    PaymentsController,
    PaymentNotifyController,
    AdminPaymentChannelsController,
  ],

  providers: [
    PaymentService,
    PaymentChannelService,
    PaymentAdapterRegistry,
    PaymentConfigCryptoService,

    EpayPaymentAdapter,
    AlipayPaymentAdapter,
    WechatPaymentAdapter,
  ],

  exports: [
    PaymentService,
  ],
})
export class PaymentsModule {}
```

然后在：

```
apps/backend/src/app.module.ts
```

加入：

```
import { PaymentsModule } from './modules/payments/payments.module';
```

当前 AppModule 已经按照业务模块集中导入 `WalletModule`、`ProvidersModule`、`ChatModule` 等，因此 PaymentsModule 应遵守相同模式。

# 48. 与 WalletModule 的边界

必须遵守：

```
PaymentsModule -> WalletModule
```

而不是：

```
WalletModule -> PaymentsModule
```

Wallet 是更底层的资金账本。

即：

```
支付宝
微信
易支付
Stripe
PayPal
人工充值

       │
       ▼

WalletService

       │
       ▼

WalletTransaction
```

这样未来任何充值来源都可以复用同一套账本。

# 49. 不要把 Adapter 放进 WalletService

错误：

```
walletService.alipayRecharge()

walletService.wechatRecharge()

walletService.epayRecharge()
```

正确：

```
paymentService.createPayment()

paymentService.processNotification()

walletService.recharge()
```

# 50. 首期实现范围

V1 必须实现：

```
PaymentChannel 数据模型

PaymentOrder 数据模型

PaymentCallbackEvent

PaymentChannelAdapter

PaymentAdapterRegistry

PaymentChannelService

PaymentService

配置加密

支付订单 API

支付回调 API

管理员渠道管理 API

易支付 V1

支付宝官方

微信支付 API v3

支付成功进入 WalletService

创建订单幂等

支付回调幂等

主动查询订单
```

首期可以暂缓：

```
退款

部分退款

自动对账

账单下载

优惠券

充值赠送

手续费

汇率

多币种

订阅支付
```

接口层预留即可。

# 51. 推荐开发顺序

### Phase 1：数据库

增加：

```
PaymentChannel
PaymentOrder
PaymentCallbackEvent
```

完成 Prisma migration。

### Phase 2：Payment Core

实现：

```
PaymentChannelAdapter
PaymentAdapterRegistry
Payment Types
Payment Errors
PaymentChannelService
```

先写 FakePaymentAdapter 做单元测试。

### Phase 3：PaymentService

完成：

```
createPayment

getOrder

processNotification

processPaymentSuccess

syncOrder
```

接入 WalletService。

### Phase 4：易支付

易支付协议最简单，优先完成：

```
create
sign
verify
notify
query
```

用它验证整个架构。

### Phase 5：支付宝官方

实现：

```
WEB
H5
QR
notify
query
```

### Phase 6：微信官方

实现：

```
Native
H5
JSAPI
notify
query
```

### Phase 7：管理员配置

增加：

```
支付渠道列表
新增渠道
编辑渠道
启停
优先级
权重
测试连接
```

### Phase 8：用户充值 UI

增加：

```
输入充值金额
选择支付方式
选择渠道（可选）
支付二维码
跳转支付
支付状态轮询
支付成功刷新余额
```

# 52. 验收标准

支付模块完成后必须满足以下场景。

### 多渠道

同时配置：

```
易支付A
易支付B
支付宝官方
微信官方
```

系统全部可以保持 `isActive=true`。

### 扩展性

增加第四种 Adapter 时：

```
PaymentService
WalletService
PaymentController
```

原则上不需要修改业务逻辑。

### 重复通知

同一支付平台连续发送 20 次成功通知：

```
PaymentOrder = 1
WalletTransaction(RECHARGE) = 1
用户余额只增加一次
```

### 金额攻击

用户创建：

```
100 元
```

攻击者伪造：

```
1 元回调
```

系统拒绝充值。

### 假回调

验签失败：

```
钱包余额不变
订单状态不变
记录安全日志
```

### 前端伪造

用户直接访问：

```
/payment/result?success=true
```

钱包余额不变。

### 多实例

两个 EPAY 实例拥有完全不同：

```
pid
key
baseUrl
```

系统根据 `channelId` 使用对应配置。

### 超时

第三方创建请求发生未知超时：

```
不得偷偷切换另一个支付渠道创建第二笔订单。
```

# 53. 后续增加新渠道示例

以后增加：

```
Stripe
```

只需要：

```
channels/stripe/
    stripe.adapter.ts
    stripe.config.ts
    stripe.types.ts
```

然后：

```
export class StripePaymentAdapter
  implements PaymentChannelAdapter<StripeConfig> {
}
```

注册：

```
registry.register(stripeAdapter);
```

其余流程：

```
订单
回调
状态
Wallet
幂等
管理员管理
用户查询
```

全部复用。

这应该成为整个支付模块最重要的验收指标：

> **新增支付渠道，本质上应该是在写一个 Adapter，而不是修改一遍支付系统。**

# 54. 最终架构

```
                       ┌─────────────────────┐
                       │      Frontend       │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │  PaymentsController │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │   PaymentService    │
                       └─────┬────────┬──────┘
                             │        │
                       selected       │ success
                             │        │
                             ▼        ▼
                ┌────────────────────┐  ┌──────────────┐
                │ PaymentChannelSvc │  │ WalletService│
                └───────┬────────┘  └──────┬───────┘
                        │                  │
                        ▼                  ▼
              ┌──────────────────┐   WalletTransaction
              │ Adapter Registry │
              └────────┬─────────┘
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌───────────┐
   │   EPAY   │  │  Alipay  │  │ WeChatPay │
   │ Adapter  │  │ Adapter  │  │  Adapter  │
   └────┬─────┘  └────┬─────┘  └─────┬─────┘
        │             │               │
        ▼             ▼               ▼
   易支付接口      支付宝官方       微信支付 API v3
```

# 55. 结论

Lumina V1 的支付系统不应设计成“分别写三个支付接口”，而应该先完成一个稳定的 **Payment Core**：

```
PaymentChannelAdapter
+
PaymentAdapterRegistry
+
PaymentChannel Instance
+
PaymentOrder
+
PaymentService
+
Wallet 幂等入账
```

然后易支付、支付宝、微信只是这套 Core 上的三种 Adapter 实现。

设计上可以借鉴 new-api 的统一 Adapter 思路，同时复用 Lumina 现有 Providers 模块的多实例思想，但支付渠道由用户明确选择具体实例，不使用 `priority` 或 `weight` 自动路由。支付系统必须更加保守：第三方下单一旦存在“不确定是否成功”的情况，不允许自动切换渠道重试。

首批建议完成：

```
EPAY V1
支付宝官方 WEB / H5 / QR
微信支付 Native / H5 / JSAPI
```

并保证所有渠道最终全部转换为统一的：

```
PaymentCreateResult
PaymentNotification
PaymentQueryResult
PaymentError
```

只要这几个内部契约稳定下来，今后增加任何新的支付渠道，都可以控制在单独 Adapter 内完成，而不再污染订单、钱包和 Controller 层。
