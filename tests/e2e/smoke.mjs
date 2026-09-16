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
  const allowedStatuses =
    expectedStatuses || (options.method === 'POST' ? [200, 201] : [200]);
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

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

async function requestAuth(token, path, options = {}, expectedStatuses) {
  return requestJson(
    path,
    { ...options, headers: { ...authHeaders(token), ...(options.headers || {}) } },
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
  const adminLogin = await sendCodeAndLogin(adminEmail);
  const userLogin = await sendCodeAndLogin(userEmail);
  const adminToken = adminLogin.data.accessToken;
  const userToken = userLogin.data.accessToken;

  assert(adminToken && userToken, 'login did not return access tokens');
  assert(adminLogin.data.user.role === 'ADMIN', 'configured admin did not receive ADMIN role');
  assert(userLogin.data.user.role === 'USER', 'new user did not receive USER role');

  const adminMe = await requestAuth(adminToken, '/auth/me');
  const userMe = await requestAuth(userToken, '/auth/me');
  assert(adminMe.data.role === 'ADMIN', 'admin /auth/me role mismatch');
  assert(userMe.data.email === userEmail, 'user /auth/me email mismatch');

  const userBalance = await requestAuth(userToken, '/wallet/balance');
  assert(Number(userBalance.data.balance) === 10, 'new user initial balance mismatch');
  await requestAuth(userToken, '/providers', {}, [403]);

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
        rateLimit: 1000,
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

  const visibleModels = await requestAuth(userToken, '/providers/models?type=CHAT');
  assert(
    visibleModels.data.some((model) => model.name === chatModel.data.name),
    'active chat model is not visible to regular user',
  );

  const providerList = await requestAuth(adminToken, '/providers');
  const visibleProvider = providerList.data.find((item) => item.id === providerId);
  assert(visibleProvider, 'created provider is missing from admin list');
  assert(!Object.hasOwn(visibleProvider.config || {}, 'apiKey'), 'provider API key leaked in admin list');

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
  const streamEvents = [...streamText.matchAll(/^data:\s*(\{.*\})$/gm)].map((match) => JSON.parse(match[1]));
  const streamedContent = streamEvents
    .filter((event) => event.type === 'content')
    .map((event) => event.content)
    .join('');
  assert(streamedContent.includes('E2E mock reply'), 'chat SSE did not contain mock content');
  assert(streamEvents.some((event) => event.type === 'done'), 'chat SSE did not finish with done event');

  const messages = await requestAuth(userToken, `/chat/sessions/${session.data.id}/messages`);
  assert(messages.data.total === 2, `expected two chat messages, got ${messages.data.total}`);

  const imageTask = await requestAuth(userToken, '/image/generate', {
    method: 'POST',
    body: {
      prompt: 'a tiny e2e test image',
      model: imageModel.data.name,
      aspectRatio: '1:1',
    },
  });
  const completedImage = await pollImageTask(userToken, imageTask.data.id);
  assert(completedImage.imageKey, 'successful image task did not store an object key');
  assert(completedImage.imageUrl, 'successful image task did not return a signed URL');

  const imageHistory = await requestAuth(userToken, '/image/history');
  assert(imageHistory.data.total >= 1, 'image history did not contain generated task');

  const auditLogs = await requestAuth(adminToken, '/admin/audit-logs?limit=100');
  const actions = auditLogs.data.items.map((item) => item.action);
  assert(actions.includes('provider.created'), 'provider creation was not audited');
  assert(actions.includes('platform_model.created'), 'model creation was not audited');
  assert(actions.includes('upstream_model.created'), 'upstream creation was not audited');

  console.log('Lumina E2E smoke passed: auth, RBAC, admin config, chat SSE, image queue, MinIO, history, audit');
}

main().catch((error) => {
  console.error(`Lumina E2E smoke failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
