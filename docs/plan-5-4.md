# 5-4 前端聊天页 UI（已完成）

> 状态更新：2026-09-16。原规划中的实现已落到 `apps/frontend/src/app/chat/` 及 `apps/frontend/src/lib/chat-api.ts`。本次已通过前端生产构建；会话、SSE、余额、钱包和真实 Provider 的端到端验证仍未执行。以下内容保留为原始实现规划，不应再作为“待开发”事项。

## 原始目标

实现完整的聊天页前端交互，替换当前占位代码。

## 现有前端基础设施

- Next.js 14 App Router + React 18 + Tailwind CSS 3
- `lib/api-client.ts`: fetch 封装，已含 `stream()` 方法用于 SSE
- `lib/auth.ts`: JWT token 管理（localStorage + cookie）
- `middleware.ts`: 路由保护（未登录重定向 /login）
- `next.config.ts`: rewrites `/api/*` → `backend:3001`
- 登录页已完整实现（邮箱+验证码+倒计时）
- 聊天页 `chat/page.tsx` 目前是纯占位 HTML

## 后端 API（5-4 需要调用的）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/chat/sessions` | 创建会话 |
| GET | `/chat/sessions?page=1&limit=20` | 会话列表 |
| GET | `/chat/sessions/:id` | 会话详情 |
| PATCH | `/chat/sessions/:id` | 更新标题 |
| DELETE | `/chat/sessions/:id` | 删除会话 |
| GET | `/chat/sessions/:id/messages?page=1&limit=50` | 历史消息 |
| POST | `/chat/messages` | 发送消息（SSE 流式） |
| GET | `/providers/models?type=CHAT` | 获取可用聊天模型列表 |
| GET | `/wallet/balance` | 获取余额 |

## SSE 事件格式

```
data: {"type":"content","content":"文本片段"}\n\n
data: {"type":"done","usage":{"inputTokens":10,"outputTokens":20,"totalTokens":30},"cost":0.002}\n\n
data: {"type":"error","message":"错误信息"}\n\n
```

## 拆分步骤

### 5-4-1. API 调用层

文件：`apps/frontend/src/lib/chat-api.ts`

封装所有聊天相关 API 调用，让组件专注于 UI：
- `createSession(title?: string)` → `POST /chat/sessions`
- `getSessions(page?, limit?)` → `GET /chat/sessions`
- `getSession(id)` → `GET /chat/sessions/:id`
- `updateSession(id, title)` → `PATCH /chat/sessions/:id`
- `deleteSession(id)` → `DELETE /chat/sessions/:id`
- `getMessages(sessionId, page?, limit?)` → `GET /chat/sessions/:id/messages`
- `getChatModels()` → `GET /providers/models?type=CHAT`
- `sendMessageStream(sessionId, content, model, options?)` → `POST /chat/messages`
  - 使用 `apiClient.stream()` 获取 Response
  - 用 ReadableStream + TextDecoder 逐行解析 SSE
  - 返回 async generator 或回调模式，yield/emit 每个事件

### 5-4-2. 类型定义

文件：`apps/frontend/src/lib/chat-types.ts`

从 `@lumina/shared` 导入已有类型，补充前端专用：
- `ChatSession` — 会话（id, title, createdAt, updatedAt）
- `ChatMessage` — 消息（id, role, content, tokens?, cost?, createdAt）
- `ChatModel` — 模型（id, name, displayName）
- `SSEEvent` — 流式事件联合类型 `{type:'content',content} | {type:'done',usage,cost} | {type:'error',message}`
- `BalanceInfo` — 余额（balance, walletId）

### 5-4-3. 聊天页主组件

文件：`apps/frontend/src/app/chat/page.tsx`

整体布局（参考现有占位的两栏结构）：
```
┌─────────────┬──────────────────────────────┐
│  侧边栏      │  顶部栏（模型选择 + 余额）    │
│  - 新建按钮  ├──────────────────────────────┤
│  - 会话列表  │  消息区域（滚动）             │
│  - 删除      │  - user 气泡（右）            │
│             │  - assistant 气泡（左）       │
│             │  - 流式光标                   │
│             ├──────────────────────────────┤
│             │  输入区（textarea + 发送）    │
└─────────────┴──────────────────────────────┘
```

组件拆分：
- `ChatPage` — 主容器，管理全局状态（会话列表、当前会话、模型、余额）
- `Sidebar` — 会话列表侧边栏
  - 新建对话按钮
  - 会话列表（高亮当前选中）
  - 每条会话可删除（hover 显示删除按钮）
- `MessageList` — 消息区域
  - 消息气泡（user 右对齐蓝色，assistant 左对齐灰色）
  - 流式输出时显示打字光标
  - 自动滚动到底部
- `MessageInput` — 输入区域
  - textarea（回车发送，Shift+回车换行）
  - 发送按钮（禁用状态：空消息/正在发送）
  - 模型选择下拉框
- `TopBar` — 顶部栏
  - 当前模型显示
  - 余额显示
  - 刷新余额按钮

### 5-4-4. SSE 流式解析

在 `chat-api.ts` 的 `sendMessageStream` 中实现：

```typescript
async function* sendMessageStream(...): AsyncGenerator<SSEEvent> {
  const res = await apiClient.stream('/chat/messages', body);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      yield JSON.parse(json) as SSEEvent;
    }
  }
}
```

组件中用 `for await` 消费，逐步更新 assistant 消息内容。

### 5-4-5. 关键交互逻辑

**会话切换：**
- 点击侧边栏会话 → 加载该会话历史消息 → 滚动到底部
- 切换时如果有正在发送的消息，提示或中止

**发送消息：**
1. 在输入框输入内容，回车发送
2. 立即在 UI 显示 user 气泡（乐观更新）
3. 创建空的 assistant 气泡（带加载光标）
4. 调用 `sendMessageStream`，逐 chunk 填充 assistant 气泡
5. 收到 `done` 事件后更新余额
6. 收到 `error` 事件后显示错误提示
7. 发送期间禁用输入框或允许取消

**新建会话：**
- 点击"新建对话" → 清空消息区 → 等用户发第一条消息时自动创建会话
- 或先创建空会话再跳转

**余额刷新：**
- 发送消息完成后自动刷新余额
- 进入页面时加载余额
- 余额不足时提示并禁用发送

**模型选择：**
- 进入页面时从 `/providers/models?type=CHAT` 加载模型列表
- 记住上次选择（localStorage）
- 切换模型时更新当前会话的模型

### 5-4-6. 样式规范

- 使用 Tailwind CSS，不引入额外 UI 库
- 消息气泡圆角、阴影、最大宽度
- 暗色模式暂不实现，只做亮色
- 移动端适配：侧边栏可折叠（暂时用 hidden md:flex）
- 滚动条样式简单处理

### 5-4-7. 验证清单

完成后需要验证：
- [ ] `pnpm --filter frontend build` 构建通过
- [ ] 创建会话、发送消息、收到流式回复
- [ ] 会话切换、历史消息加载
- [ ] 删除会话
- [ ] 模型选择切换
- [ ] 余额显示和自动刷新
- [ ] 错误处理（网络断开、余额不足等）
- [ ] 回车发送、Shift+回车换行
- [ ] 自动滚动到底部

## 实现顺序建议

1. 先写 `chat-api.ts` + `chat-types.ts`（纯逻辑，无 UI）
2. 再写 `ChatPage` 主容器 + `Sidebar`（会话列表 CRUD）
3. 再写 `MessageList` + `MessageInput`（消息展示 + SSE 流式）
4. 最后写 `TopBar`（模型选择 + 余额）和细节打磨
5. 跑 `pnpm --filter frontend build` 验证

## 注意事项

- SSE fetch 在浏览器中不支持 abort（除非用 AbortController），需要处理用户离开页面时的清理
- Next.js App Router 的 'use client' 指令必须加在页面顶部
- 不要用 `@nestjs/*` 的任何 import，前端只从 `@lumina/shared` 导入类型
- `apiClient.stream()` 已封装好 token 注入，直接用
- Tailwind 类名不要太长，合理拆分组件
