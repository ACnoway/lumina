import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authPath = path.join(repoRoot, 'apps/frontend/src/lib/auth.ts');
const authSource = fs
  .readFileSync(authPath, 'utf8')
  .replace(/^import .* from '@lumina\/shared';\r?\n/, '');
const authCode = ts.transpileModule(authSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function createDocument() {
  let tokenCookie = null;

  return {
    get cookie() {
      return tokenCookie ? `lumina_token=${tokenCookie}` : '';
    },
    set cookie(value) {
      const [pair, ...attributes] = value.split(';');
      const separatorIndex = pair.indexOf('=');
      const key = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
      const encodedValue = separatorIndex === -1 ? '' : pair.slice(separatorIndex + 1);
      const maxAge = attributes
        .map((attribute) => attribute.trim())
        .find((attribute) => attribute.toLowerCase().startsWith('max-age='));

      if (key === 'lumina_token') {
        tokenCookie = maxAge === 'max-age=0' ? null : encodedValue;
      }
    },
  };
}

function loadAuth({ storage, userAgent }) {
  const module = { exports: {} };
  const document = createDocument();
  const context = {
    module,
    exports: module.exports,
    document,
    navigator: { userAgent },
    window: { localStorage: storage },
  };

  vm.runInNewContext(authCode, context, { filename: authPath });
  return { auth: module.exports, document };
}

const response = {
  accessToken: 'jwt.token=mobile-safe',
  user: {
    id: 'user-1',
    email: 'mobile@example.com',
    nickname: 'Mobile User',
    avatar: null,
    role: 'USER',
    status: 'ACTIVE',
  },
};

const storageCalls = [];
const storedValues = new Map();
const storage = {
  getItem(key) {
    storageCalls.push(`get:${key}`);
    return storedValues.get(key) ?? null;
  },
  setItem(key, value) {
    storageCalls.push(`set:${key}`);
    storedValues.set(key, value);
  },
  removeItem(key) {
    storageCalls.push(`remove:${key}`);
    storedValues.delete(key);
  },
};

const normal = loadAuth({
  storage,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
});
normal.auth.saveAuth(response);
assert.equal(normal.auth.getToken(), response.accessToken);
assert.equal(JSON.stringify(normal.auth.getStoredUser()), JSON.stringify(response.user));
assert.deepEqual(storageCalls.slice(0, 2), ['set:lumina_token', 'set:lumina_user']);
assert.match(normal.document.cookie, /^lumina_token=/);

const throwingStorage = {
  getItem() {
    throw new Error('localStorage blocked');
  },
  setItem() {
    throw new Error('localStorage blocked');
  },
  removeItem() {
    throw new Error('localStorage blocked');
  },
};
const restricted = loadAuth({
  storage: throwingStorage,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
});

assert.doesNotThrow(() => restricted.auth.saveAuth(response));
assert.equal(restricted.auth.getToken(), response.accessToken);
assert.equal(restricted.auth.getStoredUser(), null);
assert.doesNotThrow(() => restricted.auth.clearAuth());
assert.equal(restricted.auth.getToken(), null);

console.log('Auth storage checks passed: mobile UA, localStorage failure, cookie fallback, clearAuth');
