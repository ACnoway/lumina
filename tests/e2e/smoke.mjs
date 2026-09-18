const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3001';
const mailhogUrl = process.env.E2E_MAILHOG_URL || 'http://127.0.0.1:8025';
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 120000);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(path, options = {}, expectedStatuses) {
  const allowedStatuses = expectedStatuses || (options.method === 'POST' ? [200, 201] : [200]);
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  assert(
    allowedStatuses.includes(response.status),
    `${options.method || 'GET'} ${path} expected ${allowedStatuses.join(', ')}, got ${response.status}: ${text}`,
  );

  return { response, data, text };
}

async function waitFor(name, callback, deadline = Date.now() + timeoutMs) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${name}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForMailCode(email, afterTimestamp) {
  return waitFor(`verification mail for ${email}`, async () => {
    const response = await fetch(`${mailhogUrl}/api/v2/messages?limit=100`);
    if (!response.ok) return null;

    const payload = await response.json();
    const messages = Array.isArray(payload.items) ? payload.items : [];
    const candidates = messages
      .filter((message) => {
        const serialized = JSON.stringify(message).toLowerCase();
        const createdAt = Date.parse(message.Created || message.created || '') || 0;
        return (
          serialized.includes(email.toLowerCase()) &&
          (createdAt === 0 || createdAt >= afterTimestamp)
        );
      })
      .sort((left, right) => {
        const leftTime = Date.parse(left.Created || left.created || '') || 0;
        const rightTime = Date.parse(right.Created || right.created || '') || 0;
        return rightTime - leftTime;
      });

    for (const message of candidates) {
      const body = message.Content?.Body || message.content?.body || JSON.stringify(message);
      const matches = [...String(body).matchAll(/(?<!\d)\d{6}(?!\d)/g)];
      const code = matches.at(-1)?.[0];
      if (code) return code;
    }
    return null;
  });
}

async function sendCodeAndLogin(email) {
  const sentAt = Date.now() - 1000;
  await requestJson('/auth/send-code', {
    method: 'POST',
    body: { email },
  });
  const code = await waitForMailCode(email, sentAt);
  return requestJson('/auth/login', {
    method: 'POST',
    body: { email, code },
  });
}

async function registerAndLogin(email, nickname) {
  const sentAt = Date.now() - 1000;
  await requestJson('/auth/register/send-code', {
    method: 'POST',
    body: { email },
  });
  const code = await waitForMailCode(email, sentAt);
  return requestJson('/auth/register', {
    method: 'POST',
    body: {
      email,
      code,
      nickname,
      password: 'E2ePassword1',
      confirmPassword: 'E2ePassword1',
    },
  });
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

async function requestAuth(token, path, options = {}, expectedStatuses) {
  return requestJson(
    path,
    {
      ...options,
      headers: { ...authHeaders(token), ...(options.headers || {}) },
    },
    expectedStatuses,
  );
}

async function pollImageTask(token, taskId) {
  return waitFor(`image task ${taskId}`, async () => {
    const result = await requestAuth(token, `/image/tasks/${taskId}`);
    if (result.data?.status === 'FAILED') {
      throw new Error(`image task failed: ${result.data.errorMessage || 'unknown error'}`);
    }
    return result.data?.status === 'SUCCESS' ? result.data : null;
  });
}

async function main() {
  await waitFor('backend health', async () => {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  });

  const frontend = await fetch('http://127.0.0.1:3000/login');
  assert(frontend.ok, `frontend /login returned ${frontend.status}`);

  const adminEmail = 'e2e-admin@example.com';
  const userEmail = `e2e-user-${Date.now()}@example.com`;
  const unregisteredEmail = `e2e-unregistered-${Date.now()}@example.com`;
  await requestJson(
    '/auth/send-code',
    {
      method: 'POST',
      body: { email: unregisteredEmail },
    },
    [400],
  );
  const adminLogin = await sendCodeAndLogin(adminEmail);
  const userLogin = await registerAndLogin(userEmail, 'E2E User');
  const adminToken = adminLogin.data.accessToken;
  const userToken = userLogin.data.accessToken;

  assert(adminToken && userToken, 'login did not return access tokens');
  assert(adminLogin.data.user.role === 'ADMIN', 'configured admin did not receive ADMIN role');
  assert(userLogin.data.user.role === 'USER', 'registered user did not receive USER role');
  assert(userLogin.data.user.nickname === 'E2E User', 'registered nickname was not persisted');

  const passwordLogin = await requestJson('/auth/password-login', {
    method: 'POST',
    body: { email: userEmail, password: 'E2ePassword1' },
  });
  assert(
    passwordLogin.data.user.id === userLogin.data.user.id,
    'password login returned a different user',
  );

  await requestJson(
    '/users/me/password',
    {
      method: 'PATCH',
      body: {
        currentPassword: 'E2ePassword1',
        newPassword: 'E2ePassword2',
        confirmPassword: 'E2ePassword2',
      },
    },
    [401],
  );
  await requestAuth(
    userToken,
    '/users/me/password',
    {
      method: 'PATCH',
      body: {
        currentPassword: 'WrongPassword1',
        newPassword: 'E2ePassword2',
        confirmPassword: 'E2ePassword2',
      },
    },
    [400],
  );
  const changedPassword = await requestAuth(userToken, '/users/me/password', {
    method: 'PATCH',
    body: {
      currentPassword: 'E2ePassword1',
      newPassword: 'E2ePassword2',
      confirmPassword: 'E2ePassword2',
    },
  });
  assert(changedPassword.data.message === '密码修改成功', 'password change did not succeed');
  await requestJson(
    '/auth/password-login',
    {
      method: 'POST',
      body: { email: userEmail, password: 'E2ePassword1' },
    },
    [401],
  );
  const changedPasswordLogin = await requestJson('/auth/password-login', {
    method: 'POST',
    body: { email: userEmail, password: 'E2ePassword2' },
  });
  assert(changedPasswordLogin.data.user.id === userLogin.data.user.id, 'new password login failed');

  const codeLogin = await sendCodeAndLogin(userEmail);
  assert(codeLogin.data.user.id === userLogin.data.user.id, 'code login returned a different user');

  const adminMe = await requestAuth(adminToken, '/auth/me');
  const userMe = await requestAuth(userToken, '/auth/me');
  assert(adminMe.data.role === 'ADMIN', 'admin /auth/me role mismatch');
  assert(userMe.data.email === userEmail, 'user /auth/me email mismatch');

  const userBalance = await requestAuth(userToken, '/wallet/balance');
  assert(Number(userBalance.data.balance) === 10, 'new user initial balance mismatch');
  await requestAuth(userToken, '/providers', {}, [403]);
  await requestAuth(userToken, '/admin/users', {}, [403]);

  const userId = userLogin.data.user.id;
  const adminUsers = await requestAuth(
    adminToken,
    `/admin/users?search=${encodeURIComponent(userEmail)}&limit=10`,
  );
  assert(
    adminUsers.data.items.some((item) => item.id === userId && item.email === userEmail),
    'admin user search did not return the new user',
  );

  const adminUserBefore = await requestAuth(adminToken, `/admin/users/${userId}`);
  assert(adminUserBefore.data.status === 'ACTIVE', 'new user admin status mismatch');
  assert(Number(adminUserBefore.data.wallet?.balance) === 10, 'admin user wallet balance mismatch');

  const suspendedUser = await requestAuth(adminToken, `/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: { status: 'SUSPENDED' },
  });
  assert(suspendedUser.data.status === 'SUSPENDED', 'admin user suspension did not take effect');
  await requestAuth(userToken, '/wallet/balance', {}, [401]);

  const reactivatedUser = await requestAuth(adminToken, `/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: { status: 'ACTIVE' },
  });
  assert(reactivatedUser.data.status === 'ACTIVE', 'admin user reactivation did not take effect');
  const reactivatedBalance = await requestAuth(userToken, '/wallet/balance');
  assert(Number(reactivatedBalance.data.balance) === 10, 'reactivated user wallet access mismatch');

  const adjustmentReason = 'E2E balance adjustment';
  const balanceAdjustment = await requestAuth(adminToken, '/admin/wallet/adjustments', {
    method: 'POST',
    body: { userId, amount: 2.5, reason: adjustmentReason },
  });
  assert(balanceAdjustment.data.type === 'ADMIN_ADJUST', 'admin wallet adjustment type mismatch');
  assert(Number(balanceAdjustment.data.amount) === 2.5, 'admin wallet adjustment amount mismatch');
  assert(
    Number(balanceAdjustment.data.balance) === 12.5,
    'admin wallet adjustment balance mismatch',
  );
  assert(
    balanceAdjustment.data.reason === adjustmentReason,
    'admin wallet adjustment reason mismatch',
  );

  const adminUserAfter = await requestAuth(adminToken, `/admin/users/${userId}`);
  assert(
    Number(adminUserAfter.data.wallet?.balance) === 12.5,
    'admin user balance was not persisted',
  );
  const adminTransactions = await requestAuth(
    adminToken,
    `/admin/users/${userId}/transactions?limit=10`,
  );
  assert(
    adminTransactions.data.items.some(
      (item) =>
        item.type === 'ADMIN_ADJUST' &&
        item.reason === adjustmentReason &&
        Number(item.balance) === 12.5,
    ),
    'admin user ledger did not contain the balance adjustment',
  );

  const provider = await requestAuth(adminToken, '/providers', {
    method: 'POST',
    body: {
      name: `mock-provider-${Date.now()}`,
      apiFormat: 'openai_compatible',
      supportsStreaming: true,
      config: {
        apiKey: 'e2e-key',
        baseUrl: 'http://mock-provider:8080/v1',
        timeout: 5000,
        rateLimit: 2,
      },
    },
  });
  const providerId = provider.data.id;

  const chatModel = await requestAuth(adminToken, '/providers/models', {
    method: 'POST',
    body: {
      name: `e2e-chat-${Date.now()}`,
      displayName: 'E2E Chat',
      type: 'CHAT',
      pricing: { input: 0.001, output: 0.001 },
      maxTokens: 100,
    },
  });
  const imageModel = await requestAuth(adminToken, '/providers/models', {
    method: 'POST',
    body: {
      name: `e2e-image-${Date.now()}`,
      displayName: 'E2E Image',
      type: 'IMAGE',
      pricing: { perImage: 0.01 },
    },
  });

  await requestAuth(adminToken, `/providers/models/${chatModel.data.id}/upstreams`, {
    method: 'POST',
    body: {
      providerId,
      upstreamModelId: 'mock-chat-model',
      priority: 1,
      weight: 1,
    },
  });
  await requestAuth(adminToken, `/providers/models/${imageModel.data.id}/upstreams`, {
    method: 'POST',
    body: {
      providerId,
      upstreamModelId: 'mock-image-model',
      priority: 1,
      weight: 1,
    },
  });

  const promptOptimizerBefore = await requestAuth(adminToken, '/admin/settings/prompt-optimizer');
  assert(
    promptOptimizerBefore.data && Object.hasOwn(promptOptimizerBefore.data, 'modelId'),
    'prompt optimizer setting response is missing modelId',
  );
  const promptOptimizerSetting = await requestAuth(adminToken, '/admin/settings/prompt-optimizer', {
    method: 'PATCH',
    body: { modelId: chatModel.data.id },
  });
  assert(
    promptOptimizerSetting.data.modelId === chatModel.data.id,
    'admin prompt optimizer model setting did not persist',
  );
  const optimizedPrompt = await requestAuth(userToken, '/image/optimize-prompt', {
    method: 'POST',
    body: { prompt: 'a tiny e2e test image' },
  });
  assert(
    optimizedPrompt.data.optimizedPrompt === 'E2E mock reply: a tiny e2e test image',
    'prompt optimizer did not call the configured chat model',
  );
  assert(Number.isFinite(Number(optimizedPrompt.data.cost)), 'prompt optimizer cost is invalid');
  await requestAuth(userToken, '/admin/settings/prompt-optimizer', {}, [403]);

  const visibleModels = await requestAuth(userToken, '/providers/models?type=CHAT');
  assert(
    visibleModels.data.some((model) => model.name === chatModel.data.name),
    'active chat model is not visible to regular user',
  );

  const providerList = await requestAuth(adminToken, '/providers');
  const visibleProvider = providerList.data.find((item) => item.id === providerId);
  assert(visibleProvider, 'created provider is missing from admin list');
  assert(
    !Object.hasOwn(visibleProvider.config || {}, 'apiKey'),
    'provider API key leaked in admin list',
  );

  const upstreamList = await requestAuth(
    adminToken,
    `/providers/models/${chatModel.data.id}/upstreams`,
  );
  assert(
    upstreamList.data.every((item) => !Object.hasOwn(item.provider?.config || {}, 'apiKey')),
    'provider API key leaked through upstream management response',
  );

  const session = await requestAuth(userToken, '/chat/sessions', {
    method: 'POST',
    body: { title: 'E2E chat' },
  });
  const streamResponse = await fetch(`${baseUrl}/chat/messages`, {
    method: 'POST',
    headers: { ...authHeaders(userToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.data.id,
      content: '请回复 E2E',
      model: chatModel.data.name,
      maxTokens: 40,
    }),
  });
  const streamText = await streamResponse.text();
  assert(streamResponse.ok, `chat stream returned ${streamResponse.status}: ${streamText}`);
  const streamEvents = [...streamText.matchAll(/^data:\s*(\{.*\})$/gm)].map((match) =>
    JSON.parse(match[1]),
  );
  const streamedContent = streamEvents
    .filter((event) => event.type === 'content')
    .map((event) => event.content)
    .join('');
  assert(streamedContent.includes('E2E mock reply'), 'chat SSE did not contain mock content');
  assert(
    streamEvents.some((event) => event.type === 'done'),
    'chat SSE did not finish with done event',
  );

  const messages = await requestAuth(userToken, `/chat/sessions/${session.data.id}/messages`);
  assert(messages.data.total === 2, `expected two chat messages, got ${messages.data.total}`);

  const rateLimitedChat = await requestAuth(
    userToken,
    '/chat/messages',
    {
      method: 'POST',
      body: {
        sessionId: session.data.id,
        content: '请再次回复 E2E',
        model: chatModel.data.name,
        maxTokens: 40,
      },
    },
    [503],
  );
  assert(
    rateLimitedChat.data.message === '所有上游均不可用',
    'provider sliding-window rate limit did not reject the second request',
  );

  const imageTask = await requestAuth(userToken, '/image/generate', {
    method: 'POST',
    body: {
      prompt: 'a tiny e2e test image',
      negativePrompt: 'blurry, watermark',
      model: imageModel.data.name,
      aspectRatio: '1:1',
      imageCount: 4,
    },
  });
  const completedImage = await pollImageTask(userToken, imageTask.data.id);
  assert(completedImage.imageKey, 'successful image task did not store an object key');
  assert(completedImage.imageUrl, 'successful image task did not return a signed URL');
  assert(completedImage.images?.length === 4, 'four-image task did not return four image records');
  assert(
    Number(completedImage.cost) === 0.04,
    'four-image task was not charged per successful image',
  );

  const imageHistory = await requestAuth(userToken, '/image/history');
  assert(imageHistory.data.total >= 1, 'image history did not contain generated task');
  const historyImage = imageHistory.data.items.find((item) => item.id === imageTask.data.id);
  assert(historyImage, 'generated image task was missing from history');
  assert(historyImage.prompt === 'a tiny e2e test image', 'positive prompt was not preserved');
  assert(historyImage.negativePrompt === 'blurry, watermark', 'negative prompt was not preserved');
  assert(historyImage.images?.length === 4, 'image history did not include all four images');

  const auditLogs = await requestAuth(adminToken, '/admin/audit-logs?limit=100');
  const actions = auditLogs.data.items.map((item) => item.action);
  assert(actions.includes('provider.created'), 'provider creation was not audited');
  assert(actions.includes('platform_model.created'), 'model creation was not audited');
  assert(actions.includes('upstream_model.created'), 'upstream creation was not audited');
  assert(
    actions.includes('prompt_optimizer_model.updated'),
    'prompt optimizer setting was not audited',
  );
  const statusAudits = auditLogs.data.items.filter(
    (item) => item.action === 'user.status.updated' && item.details?.targetId === userId,
  );
  assert(
    statusAudits.some(
      (item) =>
        item.details?.before?.status === 'ACTIVE' && item.details?.after?.status === 'SUSPENDED',
    ),
    'user suspension audit did not preserve before/after status',
  );
  const balanceAudit = auditLogs.data.items.find(
    (item) =>
      item.action === 'wallet.balance.adjusted' &&
      item.details?.targetId === userId &&
      item.details?.reason === adjustmentReason,
  );
  assert(balanceAudit, 'wallet balance adjustment was not audited');
  assert(
    Number(balanceAudit.details.before?.balance) === 10,
    'wallet audit before balance mismatch',
  );
  assert(
    Number(balanceAudit.details.after?.balance) === 12.5,
    'wallet audit after balance mismatch',
  );

  console.log(
    'Lumina E2E smoke passed: registration, password/code auth, RBAC, admin users/status, wallet adjustment, admin config, chat SSE, image queue, MinIO, history, audit',
  );
}

main().catch((error) => {
  console.error(`Lumina E2E smoke failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
