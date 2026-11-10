import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoirServer, generateWithGemini, generateWithOpenAI } from '../server.js';

const runningServers = [];
const temporaryFolders = [];

afterEach(async () => {
  for (const server of runningServers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  for (const folder of temporaryFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function temporaryStore() {
  const folder = mkdtempSync(join(tmpdir(), 'noir-chat-test-'));
  temporaryFolders.push(folder);
  return join(folder, 'store.json');
}

async function listen(server) {
  runningServers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('Gemini adapter returns provider text and actual usage without putting the key in the URL', async () => {
  let requestUrl;
  let requestOptions;
  const result = await generateWithGemini({
    apiKey: 'private-gemini-key', model: 'gemini-test', instructions: 'system', maxOutputTokens: 200,
    messages: [{ role: 'user', text: 'Hello' }],
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Hello from Gemini.' }] } }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 5, totalTokenCount: 14 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.text, 'Hello from Gemini.');
  assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 5, totalTokens: 14 });
  assert.match(requestUrl, /gemini-test:generateContent$/);
  assert.equal(new URL(requestUrl).search, '');
  assert.equal(requestOptions.headers['x-goog-api-key'], 'private-gemini-key');
});

test('OpenAI adapter returns response text and actual Responses API usage', async () => {
  let requestOptions;
  const result = await generateWithOpenAI({
    apiKey: 'private-openai-key', model: 'openai-test', instructions: 'system', maxOutputTokens: 200,
    messages: [{ role: 'user', text: 'Hello' }],
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello from OpenAI.' }] }],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.text, 'Hello from OpenAI.');
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
  assert.equal(requestOptions.headers.authorization, 'Bearer private-openai-key');
  assert.equal(JSON.parse(requestOptions.body).store, false);
});

test('chat, token totals, and credits are server-owned and isolated by session', async () => {
  const observedHistory = [];
  const server = createNoirServer({
    dataFile: temporaryStore(),
    config: { provider: 'gemini', model: 'mock-model', allowRequests: true, creditsEnabled: true, startingCredits: 10, creditsPerMessage: 1, maxRequestsPerMinute: 100 },
    generate: async ({ messages }) => {
      observedHistory.push(messages);
      return { text: 'Mock AI response.', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
    },
  });
  const base = await listen(server);
  const origin = base;
  const bootResponse = await fetch(`${base}/api/bootstrap`);
  const cookie = bootResponse.headers.get('set-cookie').split(';')[0];
  const boot = await bootResponse.json();
  assert.equal(boot.session.credits, 10);
  assert.equal(boot.session.provider.ready, false); // The injected fake provider does not expose a real key.

  const postMessage = (body) => fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const firstResponse = await postMessage({ message: 'First question', credits: 900000, usage: { inputTokens: 900000 } });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.deepEqual(first.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.equal(first.session.credits, 9);
  assert.deepEqual(first.session.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.equal(first.chat.messages[0].usage.inputTokens, 4);

  const second = await (await postMessage({ chatId: first.chat.id, message: 'Follow up' })).json();
  assert.equal(second.session.credits, 8);
  assert.deepEqual(second.session.usage, { inputTokens: 8, outputTokens: 4, totalTokens: 12 });
  assert.deepEqual(observedHistory[1].map(message => message.role), ['user', 'assistant', 'user']);

  const otherSession = await (await fetch(`${base}/api/bootstrap`)).json();
  assert.equal(otherSession.session.credits, 10);
  const privateChat = await fetch(`${base}/api/chats/${first.chat.id}`, { headers: { origin } });
  assert.equal(privateChat.status, 404);
});

test('provider calls are blocked by default until the local cost opt-in is enabled', async () => {
  const server = createNoirServer({ dataFile: temporaryStore(), config: { provider: 'gemini', model: 'mock-model', geminiApiKey: 'test-key', allowRequests: false, creditsEnabled: false } });
  const base = await listen(server);
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'This should not reach an AI provider.' }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'provider_opt_in_required');
});

test('a missing provider key is reported separately from the cost opt-in', async () => {
  const server = createNoirServer({ dataFile: temporaryStore(), config: { provider: 'gemini', model: 'mock-model', allowRequests: true, creditsEnabled: false } });
  const base = await listen(server);
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'This should explain the missing key.' }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'missing_api_key');
});

test('cross-origin writes are rejected', async () => {
  const server = createNoirServer({ dataFile: temporaryStore(), config: { provider: 'gemini', model: 'mock-model', allowRequests: true, creditsEnabled: false }, generate: async () => ({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }) });
  const base = await listen(server);
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'No cross origin.' }),
  });
  assert.equal(response.status, 403);
});

test('static app is served while environment and data files remain private', async () => {
  const server = createNoirServer({ dataFile: temporaryStore(), config: { allowRequests: false } });
  const base = await listen(server);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /NOIR/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/data/noir-data.json`)).status, 404);
});

test('public signup mode blocks anonymous API access and keeps account chats isolated', async () => {
  const server = createNoirServer({
    dataFile: temporaryStore(),
    config: { authRequired: true, supabaseUrl: 'https://auth.example.test', supabaseAnonKey: 'public-anon-key', provider: 'gemini', model: 'mock-model', allowRequests: true, creditsEnabled: true, startingCredits: 7 },
    fetchImpl: async (_url, options) => {
      const token = options.headers.authorization.replace('Bearer ', '');
      return new Response(JSON.stringify({ id: token === 'account-one-token' ? 'user-one' : 'user-two', email: `${token}@example.test` }), { status: 200 });
    },
    generate: async () => ({ text: 'Signed-in response.', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }),
  });
  const base = await listen(server);
  const authInfo = await (await fetch(`${base}/api/auth-config`)).json();
  assert.deepEqual(authInfo, { required: true, configured: true, supabaseUrl: 'https://auth.example.test', supabaseAnonKey: 'public-anon-key' });
  assert.equal((await fetch(`${base}/api/bootstrap`)).status, 401);
  assert.equal((await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Anonymous' }) })).status, 401);

  const bootOne = await (await fetch(`${base}/api/bootstrap`, { headers: { authorization: 'Bearer account-one-token' } })).json();
  assert.equal(bootOne.user.email, 'account-one-token@example.test');
  assert.equal(bootOne.session.credits, 7);
  const created = await fetch(`${base}/api/chat`, { method: 'POST', headers: { authorization: 'Bearer account-one-token', origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Private chat' }) });
  assert.equal(created.status, 200);
  const chatId = (await created.json()).chat.id;
  assert.equal((await fetch(`${base}/api/chats/${chatId}`, { headers: { authorization: 'Bearer account-two-token' } })).status, 404);
  assert.equal((await fetch(`${base}/api/chats/${chatId}`, { headers: { authorization: 'Bearer account-one-token' } })).status, 200);
});

test('Supabase storage keeps an account chat after the server restarts', async () => {
  let cloudRow = null;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'durable-user', email: 'user@example.test' }), { status: 200 });
    if (url.includes('/rest/v1/noir_user_data')) {
      if (options.method === 'POST') { cloudRow = JSON.parse(options.body); return new Response(null, { status: 201 }); }
      return new Response(JSON.stringify(cloudRow ? [cloudRow] : []), { status: 200 });
    }
    throw new Error('Unexpected test request');
  };
  const dataFile = temporaryStore();
  const server = createNoirServer({
    dataFile,
    config: { authRequired: true, supabaseUrl: 'https://auth.example.test', supabaseAnonKey: 'public-anon-key', supabaseServiceRoleKey: 'private-service-role', provider: 'gemini', model: 'mock-model', allowRequests: true, creditsEnabled: true, startingCredits: 7 },
    fetchImpl,
    generate: async () => ({ text: 'Saved response.', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }),
  });
  const base = await listen(server);
  const headers = { authorization: 'Bearer durable-token' };
  assert.equal((await fetch(`${base}/api/bootstrap`, { headers })).status, 200);
  const sent = await fetch(`${base}/api/chat`, { method: 'POST', headers: { ...headers, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Save this chat' }) });
  assert.equal(sent.status, 200);
  assert.equal(cloudRow.user_id, 'durable-user');
  assert.equal(cloudRow.data.chats[0].messages[0].text, 'Save this chat');
  assert.match(cloudRow.updated_at, /^\d{4}-/);

  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  runningServers.splice(runningServers.indexOf(server), 1);
  const restarted = createNoirServer({ dataFile, config: { authRequired: true, supabaseUrl: 'https://auth.example.test', supabaseAnonKey: 'public-anon-key', supabaseServiceRoleKey: 'private-service-role' }, fetchImpl });
  const restartedBase = await listen(restarted);
  const restored = await (await fetch(`${restartedBase}/api/bootstrap`, { headers })).json();
  assert.equal(restored.chats.length, 1);
  const history = await (await fetch(`${restartedBase}/api/chats/${restored.chats[0].id}`, { headers })).json();
  assert.equal(history.chat.messages.at(-1).text, 'Saved response.');
  assert.equal(history.chat.messages[0].text, 'Save this chat');
});
