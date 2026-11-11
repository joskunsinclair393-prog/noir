import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadDotEnv();

const bool = (value, fallback) => value == null ? fallback : /^(1|true|yes|on)$/i.test(String(value));
const integer = (value, fallback, min = 0) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, number) : fallback;
};

export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

async function providerJson(response) {
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Provider returned HTTP ${response.status}`;
    throw new ProviderError(response.status, String(message).slice(0, 500));
  }
  return data;
}

export async function generateWithGemini({ apiKey, model, messages, instructions, maxOutputTokens, fetchImpl = fetch }) {
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.text }],
  }));
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents,
      generationConfig: { maxOutputTokens, temperature: 0.7 },
    }),
  });
  const data = await providerJson(response);
  const text = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
  const metadata = data.usageMetadata || {};
  if (!text) throw new ProviderError(502, 'The model returned an empty response.');
  if (!Number.isFinite(metadata.promptTokenCount) || !Number.isFinite(metadata.candidatesTokenCount)) {
    throw new ProviderError(502, 'The model response did not include token usage.');
  }
  return {
    text,
    usage: {
      inputTokens: metadata.promptTokenCount,
      outputTokens: metadata.candidatesTokenCount,
      totalTokens: Number.isFinite(metadata.totalTokenCount) ? metadata.totalTokenCount : metadata.promptTokenCount + metadata.candidatesTokenCount,
    },
  };
}

export async function generateWithOpenAI({ apiKey, model, messages, instructions, maxOutputTokens, reasoningEffort, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      instructions,
      input: messages.map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.text })),
      max_output_tokens: maxOutputTokens,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      store: false,
    }),
  });
  const data = await providerJson(response);
  const text = (data.output || []).filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text || '').join('').trim();
  const metadata = data.usage || {};
  if (!text) throw new ProviderError(502, 'The model returned an empty response.');
  if (!Number.isFinite(metadata.input_tokens) || !Number.isFinite(metadata.output_tokens)) {
    throw new ProviderError(502, 'The model response did not include token usage.');
  }
  return {
    text,
    usage: {
      inputTokens: metadata.input_tokens,
      outputTokens: metadata.output_tokens,
      totalTokens: Number.isFinite(metadata.total_tokens) ? metadata.total_tokens : metadata.input_tokens + metadata.output_tokens,
    },
  };
}

export async function generateWithGroq({ apiKey, model, messages, instructions, maxOutputTokens, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions },
        ...messages.map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.text })),
      ],
      max_tokens: maxOutputTokens,
      temperature: 0.7,
      stream: false,
    }),
  });
  const data = await providerJson(response);
  const text = String(data.choices?.[0]?.message?.content || '').trim();
  const metadata = data.usage || {};
  if (!text) throw new ProviderError(502, 'The model returned an empty response.');
  if (!Number.isFinite(metadata.prompt_tokens) || !Number.isFinite(metadata.completion_tokens)) {
    throw new ProviderError(502, 'The model response did not include token usage.');
  }
  return {
    text,
    usage: {
      inputTokens: metadata.prompt_tokens,
      outputTokens: metadata.completion_tokens,
      totalTokens: Number.isFinite(metadata.total_tokens) ? metadata.total_tokens : metadata.prompt_tokens + metadata.completion_tokens,
    },
  };
}

function readJsonBody(request, maxBytes = 96 * 1024) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) tooLarge = true;
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, data, headers = {}) {
  const body = JSON.stringify(data);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(body);
}

function cookieValue(request, name) {
  const cookies = (request.headers.cookie || '').split(';');
  for (const item of cookies) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return decodeURIComponent(item.slice(index + 1).trim());
  }
  return null;
}

function normalizedUsage(usage) {
  const inputTokens = Math.max(0, Math.floor(Number(usage.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.floor(Number(usage.outputTokens) || 0));
  const totalTokens = Math.max(inputTokens + outputTokens, Math.floor(Number(usage.totalTokens) || 0));
  return { inputTokens, outputTokens, totalTokens };
}

function resolveTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) return 'UTC';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { return 'UTC'; }
}

function currentDateForTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.weekday}, ${values.year}-${values.month}-${values.day}`;
}

function systemInstructions(timeZone) {
  return `Helpful, accurate, concise assistant. Admit uncertainty. Today in ${timeZone}: ${currentDateForTimeZone(timeZone)}. Use for date questions.`;
}

function dateKeyForTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dailyTokenUsage(data) {
  const today = dateKeyForTimeZone('UTC');
  const saved = data.dailyTokenUsage;
  return saved?.date === today && Number.isFinite(saved.tokens)
    ? { date: today, tokens: Math.max(0, Math.floor(saved.tokens)) }
    : { date: today, tokens: 0 };
}

function publicError(error) {
  if (error instanceof ProviderError) {
    if (error.status === 429) return { status: 429, message: 'The AI provider rate limit was reached. Please try again shortly.', code: 'provider_rate_limit' };
    if (error.status === 401 || error.status === 403) return { status: 502, message: 'The provider rejected this API key or model. Check your key, model name, and provider account access.', code: 'provider_auth' };
    return { status: 502, message: 'The AI provider could not complete this request. Check the provider status and try again.', code: 'provider_error' };
  }
  if (error.status === 400 || error.status === 401 || error.status === 404 || error.status === 413 || error.status === 429 || error.status === 402 || error.status === 403 || error.status === 503) {
    return { status: error.status, message: error.message, code: error.code };
  }
  return { status: 500, message: 'Something went wrong on the NOIR server. Please try again.', code: 'server_error' };
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createNoirServer(options = {}) {
  const env = options.config || {};
  const config = {
    provider: String(env.provider ?? process.env.AI_PROVIDER ?? 'gemini').trim().toLowerCase(),
    model: String(env.model ?? process.env.AI_MODEL ?? 'gemini-3.8-flash').trim(),
    geminiApiKey: String(env.geminiApiKey ?? process.env.GEMINI_API_KEY ?? ''),
    openaiApiKey: String(env.openaiApiKey ?? process.env.OPENAI_API_KEY ?? ''),
    groqApiKey: String(env.groqApiKey ?? process.env.GROQ_API_KEY ?? ''),
    allowRequests: env.allowRequests ?? bool(process.env.ALLOW_BILLABLE_REQUESTS, false),
    creditsEnabled: env.creditsEnabled ?? bool(process.env.ENABLE_CREDITS, true),
    startingCredits: integer(env.startingCredits ?? process.env.STARTING_CREDITS, 100),
    creditsPerMessage: integer(env.creditsPerMessage ?? process.env.CREDITS_PER_MESSAGE, 1, 1),
    unlimitedAccessEmails: new Set(String(env.unlimitedAccessEmails ?? process.env.UNLIMITED_ACCESS_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)),
    maxOutputTokens: integer(env.maxOutputTokens ?? process.env.MAX_OUTPUT_TOKENS, 1024, 64),
    dailyTokenLimit: integer(env.dailyTokenLimit ?? process.env.MAX_DAILY_TOKENS, 0, 0),
    reasoningEffort: String(env.reasoningEffort ?? process.env.OPENAI_REASONING_EFFORT ?? ''),
    maxRequestsPerMinute: integer(env.maxRequestsPerMinute ?? process.env.MAX_REQUESTS_PER_MINUTE, 12, 1),
    maxPublicRequestsPerMinute: integer(env.maxPublicRequestsPerMinute ?? process.env.MAX_PUBLIC_REQUESTS_PER_MINUTE, 20, 1),
    secureCookie: env.secureCookie ?? process.env.NODE_ENV === 'production',
    authRequired: env.authRequired ?? bool(process.env.AUTH_REQUIRED, false),
    supabaseUrl: String(env.supabaseUrl ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, ''),
    supabaseAnonKey: String(env.supabaseAnonKey ?? process.env.SUPABASE_ANON_KEY ?? ''),
    supabaseServiceRoleKey: String(env.supabaseServiceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''),
  };
  const dataFile = resolve(options.dataFile || join(ROOT, 'data', 'noir-data.json'));
  mkdirSync(dirname(dataFile), { recursive: true });
  let store = { sessions: {} };
  if (existsSync(dataFile)) {
    try {
      const loaded = JSON.parse(readFileSync(dataFile, 'utf8'));
      if (loaded && loaded.sessions && typeof loaded.sessions === 'object') store = loaded;
    } catch { /* Keep an unreadable store untouched until a new session is saved. */ }
  }

  function saveStore() {
    const tempFile = `${dataFile}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tempFile, JSON.stringify(store), { mode: 0o600 });
    renameSync(tempFile, dataFile);
  }

  function sessionFor(request, response) {
    if (config.authRequired) throw new Error('Use authenticatedSessionFor for a public deployment.');
    const token = cookieValue(request, 'noir_session');
    if (token && /^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      const key = createHash('sha256').update(token).digest('hex');
      if (store.sessions[key]) return { key, data: store.sessions[key] };
    }
    const nextToken = randomBytes(32).toString('base64url');
    const key = createHash('sha256').update(nextToken).digest('hex');
    const data = {
      createdAt: Date.now(),
      credits: config.startingCredits,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      chats: [],
    };
    store.sessions[key] = data;
    const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=31536000'];
    if (config.secureCookie) attributes.push('Secure');
    response.setHeader('set-cookie', `noir_session=${nextToken}; ${attributes.join('; ')}`);
    saveStore();
    return { key, data };
  }

  async function authenticatedUser(request) {
    const authorization = String(request.headers.authorization || '');
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw Object.assign(new Error('Sign in to use NOIR.'), { status: 401, code: 'authentication_required' });
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw Object.assign(new Error('NOIR sign-in is not configured yet.'), { status: 503, code: 'auth_not_configured' });
    let response;
    try {
      response = await (options.fetchImpl || fetch)(`${config.supabaseUrl}/auth/v1/user`, {
        headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${token}` },
      });
    } catch {
      throw Object.assign(new Error('NOIR could not verify your sign-in. Try again.'), { status: 503, code: 'auth_unavailable' });
    }
    if (!response.ok) throw Object.assign(new Error('Your sign-in has expired. Sign in again to continue.'), { status: 401, code: 'authentication_required' });
    let user;
    try { user = await response.json(); } catch { user = null; }
    if (!user || typeof user.id !== 'string' || !user.id) throw Object.assign(new Error('NOIR could not verify your sign-in.'), { status: 401, code: 'authentication_required' });
    return {
      id: user.id,
      email: typeof user.email === 'string' ? user.email : '',
      emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
    };
  }

  function hasUnlimitedAccess(user) {
    return Boolean(config.authRequired && user?.emailConfirmed && config.unlimitedAccessEmails.has(user.email.toLowerCase()));
  }

  async function authenticatedSessionFor(user) {
    const key = createHash('sha256').update(`account:${user.id}`).digest('hex');
    if (!store.sessions[key]) {
      if (config.supabaseServiceRoleKey) {
        let response;
        try {
          const query = new URLSearchParams({ user_id: `eq.${user.id}`, select: 'data' });
          response = await (options.fetchImpl || fetch)(`${config.supabaseUrl}/rest/v1/noir_user_data?${query}`, {
            headers: { apikey: config.supabaseServiceRoleKey, authorization: `Bearer ${config.supabaseServiceRoleKey}` },
          });
        } catch {
          throw Object.assign(new Error('NOIR could not load your saved account data. Try again.'), { status: 503, code: 'storage_unavailable' });
        }
        if (!response.ok) throw Object.assign(new Error('NOIR account storage is not ready. Check the database setup and try again.'), { status: 503, code: 'storage_unavailable' });
        let rows;
        try { rows = await response.json(); } catch { rows = []; }
        const saved = rows?.[0]?.data;
        const validSaved = saved && saved.accountId === user.id && Array.isArray(saved.chats);
        store.sessions[key] = validSaved
          ? saved
          : { createdAt: Date.now(), accountId: user.id, credits: config.startingCredits, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, chats: [] };
        if (!validSaved) await persistAccountData(user.id, store.sessions[key]);
      } else {
        store.sessions[key] = { createdAt: Date.now(), accountId: user.id, credits: config.startingCredits, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, chats: [] };
        saveStore();
      }
    }
    return { key, data: store.sessions[key], user };
  }

  async function persistAccountData(userId, data) {
    if (!config.supabaseServiceRoleKey) { saveStore(); return; }
    let response;
    try {
      response = await (options.fetchImpl || fetch)(`${config.supabaseUrl}/rest/v1/noir_user_data?on_conflict=user_id`, {
        method: 'POST',
        headers: {
          apikey: config.supabaseServiceRoleKey,
          authorization: `Bearer ${config.supabaseServiceRoleKey}`,
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() }),
      });
    } catch {
      throw Object.assign(new Error('NOIR could not save your chat. Please try again.'), { status: 503, code: 'storage_unavailable' });
    }
    if (!response.ok) throw Object.assign(new Error('NOIR could not save your chat. Check the database setup and try again.'), { status: 503, code: 'storage_unavailable' });
  }

  const requestTimes = new Map();
  const publicRequestTimes = [];
  const locks = new Map();
  async function withSessionLock(key, task) {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolveLock => { release = resolveLock; });
    const queued = previous.then(() => current);
    locks.set(key, queued);
    await previous;
    try { return await task(); }
    finally {
      release();
      if (locks.get(key) === queued) locks.delete(key);
    }
  }

  function checkRateLimit(key) {
    const now = Date.now();
    if (config.authRequired) {
      while (publicRequestTimes.length && now - publicRequestTimes[0] >= 60_000) publicRequestTimes.shift();
      if (publicRequestTimes.length >= config.maxPublicRequestsPerMinute) throw Object.assign(new Error('NOIR is busy. Please try again in a minute.'), { status: 429, code: 'public_rate_limited' });
      publicRequestTimes.push(now);
    }
    const previous = (requestTimes.get(key) || []).filter(time => now - time < 60_000);
    if (previous.length >= config.maxRequestsPerMinute) throw Object.assign(new Error('You’re sending messages too quickly. Wait a moment and try again.'), { status: 429, code: 'rate_limited' });
    previous.push(now);
    requestTimes.set(key, previous);
  }

  function providerInfo() {
    const supported = config.provider === 'gemini' || config.provider === 'openai' || config.provider === 'groq';
    const hasKey = config.provider === 'gemini' ? Boolean(config.geminiApiKey) : config.provider === 'openai' ? Boolean(config.openaiApiKey) : config.provider === 'groq' ? Boolean(config.groqApiKey) : false;
    const labels = { gemini: 'Google Gemini', openai: 'OpenAI', groq: 'Groq' };
    return {
      id: config.provider,
      label: labels[config.provider] || 'Unconfigured provider',
      model: config.model,
      requestsEnabled: Boolean(config.allowRequests),
      ready: supported && hasKey && Boolean(config.model) && Boolean(config.allowRequests),
      keyConfigured: hasKey,
    };
  }

  function sessionSummary(data, user = null) {
    const daily = dailyTokenUsage(data);
    return {
      usage: data.usage,
      dailyTokens: daily.tokens,
      dailyTokenLimit: config.dailyTokenLimit || null,
      dailyTokenDate: daily.date,
      creditsEnabled: Boolean(config.creditsEnabled),
      credits: config.creditsEnabled ? data.credits : null,
      creditsUnlimited: hasUnlimitedAccess(user),
      creditsPerMessage: config.creditsPerMessage,
      provider: providerInfo(),
    };
  }

  function chatSummary(chat) {
    return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, messageCount: chat.messages.length, totalTokens: chat.totalTokens || 0 };
  }

  function sameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === request.headers.host; } catch { return false; }
  }

  async function generate(messages, timeZone = 'UTC', maxOutputTokens = config.maxOutputTokens) {
    const args = {
      model: config.model,
      messages,
      instructions: systemInstructions(timeZone),
      maxOutputTokens,
      reasoningEffort: config.reasoningEffort,
      fetchImpl: options.fetchImpl || fetch,
    };
    if (options.generate) return options.generate({ provider: config.provider, ...args });
    if (!['gemini', 'openai', 'groq'].includes(config.provider)) throw Object.assign(new Error('Set AI_PROVIDER to gemini, openai, or groq in .env.'), { status: 503, code: 'invalid_provider' });
    if (config.provider === 'gemini') {
      if (!config.geminiApiKey) throw Object.assign(new Error('Add GEMINI_API_KEY to .env before sending AI requests.'), { status: 503, code: 'missing_api_key' });
      if (!config.allowRequests) throw Object.assign(new Error('AI requests are paused by default to avoid unexpected provider charges. Review your provider’s pricing, then opt in with ALLOW_BILLABLE_REQUESTS=true in .env.'), { status: 403, code: 'provider_opt_in_required' });
      return generateWithGemini({ ...args, apiKey: config.geminiApiKey });
    }
    if (config.provider === 'openai') {
      if (!config.openaiApiKey) throw Object.assign(new Error('Add OPENAI_API_KEY to .env before sending AI requests.'), { status: 503, code: 'missing_api_key' });
      if (!config.allowRequests) throw Object.assign(new Error('AI requests are paused by default to avoid unexpected provider charges. Review your provider’s pricing, then opt in with ALLOW_BILLABLE_REQUESTS=true in .env.'), { status: 403, code: 'provider_opt_in_required' });
      return generateWithOpenAI({ ...args, apiKey: config.openaiApiKey });
    }
    if (config.provider === 'groq') {
      if (!config.groqApiKey) throw Object.assign(new Error('Add GROQ_API_KEY to .env before sending AI requests.'), { status: 503, code: 'missing_api_key' });
      if (!config.allowRequests) throw Object.assign(new Error('AI requests are paused by default to avoid unexpected provider charges. Review your provider’s pricing, then opt in with ALLOW_BILLABLE_REQUESTS=true in .env.'), { status: 403, code: 'provider_opt_in_required' });
      return generateWithGroq({ ...args, apiKey: config.groqApiKey });
    }
    throw Object.assign(new Error('Set AI_PROVIDER to gemini, openai, or groq in .env.'), { status: 503, code: 'invalid_provider' });
  }

  const server = createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    let authOrigin = '';
    try { if (config.supabaseUrl) authOrigin = new URL(config.supabaseUrl).origin; } catch {}
    response.setHeader('content-security-policy', `default-src 'self'; connect-src 'self' ${authOrigin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`);

    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && !sameOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
        if (request.method === 'GET' && url.pathname === '/api/auth-config') {
          return sendJson(response, 200, { required: config.authRequired, configured: Boolean(config.supabaseUrl && config.supabaseAnonKey), supabaseUrl: config.authRequired ? config.supabaseUrl : '', supabaseAnonKey: config.authRequired ? config.supabaseAnonKey : '' });
        }
        let accountUser = null;
        if (config.authRequired) accountUser = await authenticatedUser(request);
        const getSession = (req, res) => config.authRequired ? authenticatedSessionFor(accountUser) : Promise.resolve(sessionFor(req, res));
        if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
          const { data, user } = await getSession(request, response);
          const timeZone = resolveTimeZone(url.searchParams.get('timeZone'));
          return sendJson(response, 200, { session: sessionSummary(data, user), user: user ? { email: user.email } : null, chats: data.chats.map(chatSummary).sort((a, b) => b.updatedAt - a.updatedAt) });
        }
        if (request.method === 'GET' && url.pathname.startsWith('/api/chats/')) {
          const { data } = await getSession(request, response);
          const chatId = decodeURIComponent(url.pathname.slice('/api/chats/'.length));
          const chat = data.chats.find(item => item.id === chatId);
          if (!chat) return sendJson(response, 404, { error: 'Chat not found.' });
          return sendJson(response, 200, { chat });
        }
        if (request.method === 'DELETE' && url.pathname.startsWith('/api/chats/')) {
          const { key, data } = await getSession(request, response);
          const chatId = decodeURIComponent(url.pathname.slice('/api/chats/'.length));
          checkRateLimit(key);
          const deleted = await withSessionLock(key, async () => {
            const index = data.chats.findIndex(item => item.id === chatId);
            if (index < 0) throw Object.assign(new Error('Chat not found.'), { status: 404, code: 'chat_not_found' });
            data.chats.splice(index, 1);
            if (config.authRequired) await persistAccountData(accountUser.id, data);
            else saveStore();
            return true;
          });
          return sendJson(response, 200, { deleted });
        }
        if (request.method === 'POST' && url.pathname === '/api/chat') {
          if (!String(request.headers['content-type'] || '').includes('application/json')) return sendJson(response, 415, { error: 'Send JSON requests only.' });
          const body = await readJsonBody(request);
          const message = typeof body.message === 'string' ? body.message.trim() : '';
          const timeZone = resolveTimeZone(body.timeZone);
          if (!message) return sendJson(response, 400, { error: 'Write a message before sending.' });
          if (message.length > 12_000) return sendJson(response, 413, { error: 'Messages must be 12,000 characters or fewer.' });
          const { key, data, user } = await getSession(request, response);
          checkRateLimit(key);
          const result = await withSessionLock(key, async () => {
            if (!providerInfo().ready && !options.generate) {
              if (!config.allowRequests) await generate([]);
              if (!providerInfo().keyConfigured) await generate([]);
            }
            const unlimitedAccess = hasUnlimitedAccess(user);
            const daily = dailyTokenUsage(data);
            const remainingTokens = config.dailyTokenLimit ? config.dailyTokenLimit - daily.tokens : Infinity;
            if (remainingTokens <= 0) {
              throw Object.assign(new Error(`You’ve used today’s ${config.dailyTokenLimit} token limit. It resets at midnight UTC.`), { status: 429, code: 'daily_token_limit' });
            }
            if (config.creditsEnabled && !unlimitedAccess && data.credits < config.creditsPerMessage) {
              throw Object.assign(new Error('You’re out of NOIR credits. Add credits or turn off the optional credit limit in .env.'), { status: 402, code: 'insufficient_credits' });
            }
            const suppliedChatId = typeof body.chatId === 'string' && body.chatId ? body.chatId : null;
            let chat = suppliedChatId ? data.chats.find(item => item.id === suppliedChatId) : null;
            if (suppliedChatId && !chat) throw Object.assign(new Error('Chat not found.'), { status: 404, code: 'chat_not_found' });
            const isNewChat = !chat;
            if (isNewChat) chat = { id: randomUUID(), title: 'New chat', updatedAt: Date.now(), totalTokens: 0, messages: [] };
            const history = [];
            let historyCharacters = 0;
            for (const item of [...chat.messages, { role: 'user', text: message }].slice(-30).reverse()) {
              const itemText = String(item.text || '');
              if (history.length && historyCharacters + itemText.length > 24_000) break;
              history.unshift({ role: item.role, text: itemText });
              historyCharacters += itemText.length;
            }
            let outputBudget = config.maxOutputTokens;
            if (config.dailyTokenLimit) {
              const instructions = systemInstructions(timeZone);
              const inputCharacters = instructions.length + history.reduce((count, item) => count + item.text.length, 0);
              const estimatedInputTokens = Math.ceil(inputCharacters / 3) + history.length * 2;
              outputBudget = remainingTokens - estimatedInputTokens;
              if (outputBudget < 1) {
                throw Object.assign(new Error(`Your remaining daily token budget is too small for that prompt. The ${config.dailyTokenLimit} token limit resets at midnight UTC.`), { status: 429, code: 'daily_token_limit' });
              }
              outputBudget = Math.min(config.maxOutputTokens, outputBudget);
            }
            const generated = await generate(history, timeZone, outputBudget);
            const usage = normalizedUsage(generated.usage || {});
            if (!generated.text || !usage.inputTokens && !usage.outputTokens) throw Object.assign(new Error('The provider did not return a response with token usage.'), { status: 502, code: 'invalid_provider_response' });
            chat.title = chat.messages.length ? chat.title : (message.replace(/\s+/g, ' ').slice(0, 42) || 'New chat');
            chat.updatedAt = Date.now();
            chat.totalTokens = (chat.totalTokens || 0) + usage.totalTokens;
            chat.messages.push({ role: 'user', text: message, usage });
            chat.messages.push({ role: 'assistant', text: generated.text, usage });
            if (isNewChat) data.chats.push(chat);
            data.usage.inputTokens += usage.inputTokens;
            data.usage.outputTokens += usage.outputTokens;
            data.usage.totalTokens += usage.totalTokens;
            data.dailyTokenUsage = { date: daily.date, tokens: daily.tokens + usage.totalTokens };
            if (config.creditsEnabled && !unlimitedAccess) data.credits -= config.creditsPerMessage;
            if (config.authRequired) await persistAccountData(accountUser.id, data);
            else saveStore();
            return { chat, usage, session: sessionSummary(data, user) };
          });
          return sendJson(response, 200, result);
        }
        return sendJson(response, 404, { error: 'API route not found.' });
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
      const publicFiles = new Map([
        ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/script.js', 'script.js'], ['/logo.svg', 'logo.svg'], ['/logo.svg.png', 'logo.svg.png'],
      ]);
      const file = publicFiles.get(url.pathname);
      if (!file) return sendJson(response, 404, { error: 'Not found.' });
      const filePath = join(ROOT, file);
      const content = readFileSync(filePath);
      response.writeHead(200, { 'content-type': contentTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const issue = publicError(error);
      if (issue.status >= 500) console.error('[NOIR]', error.message);
      return sendJson(response, issue.status, { error: issue.message, code: issue.code });
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createNoirServer();
  const port = integer(process.env.PORT, 3000, 1);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`NOIR is running at http://${host}:${port}`);
    if (!bool(process.env.ALLOW_BILLABLE_REQUESTS, false)) console.log('AI requests are paused. Set ALLOW_BILLABLE_REQUESTS=true only after reviewing provider costs.');
  });
}
