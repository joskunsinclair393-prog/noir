import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoirServer, generateWithGemini, generateWithGroq, generateWithOpenAI, verifyStripeSignature } from '../server.js';

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

test('Groq adapter sends chat messages securely and returns actual token usage', async () => {
  let requestUrl;
  let requestOptions;
  const result = await generateWithGroq({
    apiKey: 'private-groq-key', model: 'llama-test', instructions: 'system', maxOutputTokens: 200,
    messages: [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi' }],
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Hello from Groq.' } }],
        usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.text, 'Hello from Groq.');
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 6, totalTokens: 17 });
  assert.equal(requestUrl, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(new URL(requestUrl).search, '');
  assert.equal(requestOptions.headers.authorization, 'Bearer private-groq-key');
  const sent = JSON.parse(requestOptions.body);
  assert.deepEqual(sent.messages.map(message => message.role), ['system', 'user', 'assistant']);
  assert.equal(sent.max_tokens, 200);
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

test('NOIR Plus keeps the free daily quota, grants access only after a signed Stripe event, and handles billing lifecycle changes', async () => {
  const userId = '7e3c12a5-1782-4c8c-9f12-6d3a8590c084';
  const webhookSecret = 'whsec_test_local_secret';
  let accountRow = null;
  let subscriptionRow = null;
  const processedEvents = new Set();
  let subscription = null;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: userId, email: 'plus-user@example.test', email_confirmed_at: new Date().toISOString() }), { status: 200 });
    if (parsed.pathname === '/rest/v1/noir_user_data') {
      if (options.method === 'POST') { accountRow = JSON.parse(options.body); return new Response(null, { status: 201 }); }
      return new Response(JSON.stringify(accountRow ? [accountRow] : []), { status: 200 });
    }
    if (parsed.pathname === '/rest/v1/noir_subscriptions') {
      if (options.method === 'POST') { subscriptionRow = JSON.parse(options.body); return new Response(null, { status: 201 }); }
      if (parsed.searchParams.has('stripe_subscription_id')) return new Response(JSON.stringify(subscriptionRow ? [subscriptionRow] : []), { status: 200 });
      return new Response(JSON.stringify(subscriptionRow && subscriptionRow.user_id === userId ? [subscriptionRow] : []), { status: 200 });
    }
    if (parsed.pathname === '/rest/v1/noir_stripe_events') {
      if (options.method === 'POST') { processedEvents.add(JSON.parse(options.body).event_id); return new Response(null, { status: 201 }); }
      return new Response(JSON.stringify(processedEvents.has(parsed.searchParams.get('event_id')?.replace('eq.', '')) ? [{ event_id: 'present' }] : []), { status: 200 });
    }
    if (parsed.pathname === '/v1/prices/price_noir_test') return new Response(JSON.stringify({ id: 'price_noir_test', active: true, currency: 'aud', unit_amount: 1500, recurring: { interval: 'month', interval_count: 1 } }), { status: 200 });
    if (parsed.pathname === '/v1/checkout/sessions') return new Response(JSON.stringify({ id: 'cs_test_noir', url: 'https://checkout.stripe.com/c/pay/cs_test_noir' }), { status: 200 });
    if (parsed.pathname === '/v1/billing_portal/sessions') return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/test' }), { status: 200 });
    if (parsed.pathname === '/v1/subscriptions/sub_noir_test') return new Response(JSON.stringify(subscription), { status: 200 });
    throw new Error(`Unexpected request to ${url}`);
  };
  const server = createNoirServer({
    dataFile: temporaryStore(),
    fetchImpl,
    config: {
      authRequired: true, supabaseUrl: 'https://auth.example.test', supabaseAnonKey: 'public-anon-key', supabaseServiceRoleKey: 'private-service-role',
      stripeSecretKey: 'sk_test_noir', stripeWebhookSecret: webhookSecret, stripePriceId: 'price_noir_test', stripeMode: 'test', publicAppUrl: 'http://127.0.0.1:3000',
      provider: 'gemini', model: 'mock-model', dailyTokenLimit: 300, creditsEnabled: false, maxRequestsPerMinute: 100, maxPublicRequestsPerMinute: 100,
    },
    generate: async () => ({ text: 'A verified AI response.', usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 } }),
  });
  const base = await listen(server);
  const headers = { authorization: 'Bearer verified-user-token', origin: base, 'content-type': 'application/json' };
  const bootstrap = await (await fetch(`${base}/api/bootstrap`, { headers })).json();
  assert.equal(bootstrap.session.dailyTokenLimit, 300);
  assert.equal(bootstrap.session.subscription.isPlus, false);

  const chat = (message) => fetch(`${base}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ message }) });
  assert.equal((await chat('First question')).status, 200);
  const capped = await chat('Another question');
  assert.equal(capped.status, 429);
  assert.equal((await capped.json()).code, 'daily_token_limit');

  const checkout = await fetch(`${base}/api/plus/checkout`, { method: 'POST', headers });
  assert.equal(checkout.status, 200);
  assert.match((await checkout.json()).url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal((await (await fetch(`${base}/api/subscription`, { headers })).json()).subscription.isPlus, false);

  const future = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  subscription = {
    id: 'sub_noir_test', object: 'subscription', customer: 'cus_noir_test', status: 'active', cancel_at_period_end: false,
    metadata: { supabase_user_id: userId },
    items: { data: [{ current_period_start: Math.floor(Date.now() / 1000), current_period_end: future }] },
  };
  const sendEvent = async (id, type, object, created = Math.floor(Date.now() / 1000)) => {
    const eventBody = Buffer.from(JSON.stringify({ id, type, created, data: { object } }));
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = (await import('node:crypto')).createHmac('sha256', webhookSecret).update(`${timestamp}.`).update(eventBody).digest('hex');
    return fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${digest}` }, body: eventBody });
  };
  const completed = await sendEvent('evt_checkout_success', 'checkout.session.completed', {
    id: 'cs_test_noir', mode: 'subscription', subscription: 'sub_noir_test', client_reference_id: userId, metadata: { supabase_user_id: userId },
  });
  assert.equal(completed.status, 200);
  assert.equal((await (await fetch(`${base}/api/subscription`, { headers })).json()).subscription.isPlus, true);
  const afterPayment = await chat('Plus response after reaching the daily free quota');
  assert.equal(afterPayment.status, 200);

  const portal = await fetch(`${base}/api/plus/manage`, { method: 'POST', headers });
  assert.equal(portal.status, 200);
  assert.match((await portal.json()).url, /^https:\/\/billing\.stripe\.com\//);

  subscription.status = 'past_due';
  const paymentFailed = await sendEvent('evt_invoice_failed', 'invoice.payment_failed', { id: 'in_failed', subscription: 'sub_noir_test' });
  assert.equal(paymentFailed.status, 200);
  assert.equal((await (await fetch(`${base}/api/subscription`, { headers })).json()).subscription.isPlus, false);

  subscription.status = 'active';
  subscription.cancel_at_period_end = true;
  const cancellationScheduled = await sendEvent('evt_cancel_scheduled', 'customer.subscription.updated', subscription);
  assert.equal(cancellationScheduled.status, 200);
  const scheduled = (await (await fetch(`${base}/api/subscription`, { headers })).json()).subscription;
  assert.equal(scheduled.isPlus, true);
  assert.equal(scheduled.cancelAtPeriodEnd, true);

  subscription.status = 'canceled';
  subscription.cancel_at_period_end = true;
  subscription.items.data[0].current_period_end = Math.floor(Date.now() / 1000) - 1;
  const canceled = await sendEvent('evt_cancel_complete', 'customer.subscription.deleted', subscription);
  assert.equal(canceled.status, 200);
  assert.equal((await (await fetch(`${base}/api/subscription`, { headers })).json()).subscription.isPlus, false);

  const expiredChat = await chat('The canceled subscription expired at period end');
  assert.equal(expiredChat.status, 429);
  assert.equal((await expiredChat.json()).code, 'daily_token_limit');

  const invalid = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad' }, body: '{}' });
  assert.equal(invalid.status, 400);
  assert.equal(verifyStripeSignature(Buffer.from('ok'), 't=1,v1=bad', webhookSecret), false);
});
