import http from 'node:http';

const port = Number(process.env.PORT || 8080);
const imagePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const imageResponses = new Map();

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function chatContent(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastMessage = messages.at(-1);
  const content = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
  return `E2E mock reply: ${content}`;
}

function writeChatStream(response, payload) {
  const content = chatContent(payload);
  const chunks = content.split(' ');
  const inputTokens = Math.max(
    1,
    Math.ceil(
      (Array.isArray(payload.messages) ? payload.messages : []).reduce(
        (total, message) => total + String(message.content || '').length,
        0,
      ) / 4,
    ),
  );
  const outputTokens = Math.max(1, chunks.length);

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  chunks.forEach((chunk, index) => {
    response.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: `${index ? ' ' : ''}${chunk}` } }],
      })}\n\n`,
    );
  });
  response.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {} }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    })}\n\n`,
  );
  response.write('data: [DONE]\n\n');
  response.end();
}

async function handle(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 404, { error: { message: 'Not found' } });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch {
    sendJson(response, 400, { error: { message: 'Invalid JSON' } });
    return;
  }

  if (url.pathname === '/v1/chat/completions') {
    if (payload.stream) {
      writeChatStream(response, payload);
      return;
    }

    const content = chatContent(payload);
    sendJson(response, 200, {
      id: 'chatcmpl-e2e',
      object: 'chat.completion',
      model: payload.model || 'e2e-chat-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
    });
    return;
  }

  if (url.pathname === '/v1/images/generations') {
    const idempotencyKey = request.headers['idempotency-key'];
    const cachedResponse =
      typeof idempotencyKey === 'string' ? imageResponses.get(idempotencyKey) : undefined;
    if (cachedResponse) {
      sendJson(response, 200, cachedResponse);
      return;
    }

    const imageResponse = {
      created: Math.floor(Date.now() / 1000),
      data: [{ b64_json: imagePng.toString('base64') }],
    };
    if (typeof idempotencyKey === 'string' && idempotencyKey) {
      imageResponses.set(idempotencyKey, imageResponse);
    }
    sendJson(response, 200, imageResponse);
    return;
  }

  sendJson(response, 404, { error: { message: 'Not found' } });
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: { message: 'Mock provider failure' } });
    } else {
      response.destroy(error);
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Lumina mock provider listening on ${port}`);
});
