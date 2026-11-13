export const providers = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  mistral: 'Mistral AI',
  xai: 'xAI Grok',
};

const endpoints = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  deepseek: 'https://api.deepseek.com/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
};

export class ProviderError extends Error {
  constructor(status, message, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export async function providerJson(response, provider) {
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const kind = String(data?.error?.code || data?.error?.type || data?.error?.status || '');
    const retryable = provider === 'deepseek' && response.status === 402 ||
      !/safety|policy|filter|refus|invalid_request|permission|auth/i.test(kind) &&
      [429, 500, 502, 503, 529].includes(response.status);
    throw new ProviderError(response.status, 'Provider returned HTTP ' + response.status, retryable);
  }
  return data;
}

export async function generateAdditional(provider, { apiKey, model, messages, instructions, maxOutputTokens, fetchImpl = fetch }) {
  if (!Object.hasOwn(endpoints, provider)) throw new ProviderError(400, 'Unsupported provider.');
  if (messages.some(message => message.attachments?.length)) throw new ProviderError(400, 'This provider supports text attachments only.');
  const claude = provider === 'anthropic';
  const turns = messages.map(({ role, text }) => ({ role, content: text }));
  const response = await fetchImpl(endpoints[provider], {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(claude
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: 'Bearer ' + apiKey }) },
    body: JSON.stringify({
      model, max_tokens: maxOutputTokens,
      ...(claude ? { system: instructions, messages: turns } : { messages: [{ role: 'system', content: instructions }, ...turns], stream: false }),
    }),
  });
  const data = await providerJson(response, provider);
  const choice = data.choices?.[0];
  const refusal = claude ? data.stop_reason === 'refusal' : choice?.finish_reason === 'content_filter' || Boolean(choice?.message?.refusal);
  if (refusal) throw new ProviderError(400, 'The provider declined this request.');
  const content = claude ? data.content : choice?.message?.content;
  const text = (Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('') : String(content || '')).trim();
  const inputTokens = claude
    ? data.usage?.input_tokens + (data.usage?.cache_read_input_tokens || 0) + (data.usage?.cache_creation_input_tokens || 0)
    : data.usage?.prompt_tokens;
  const outputTokens = claude ? data.usage?.output_tokens : data.usage?.completion_tokens;
  if (!text || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) {
    throw new ProviderError(502, 'Provider response was incomplete.');
  }
  return { text, usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } };
}

export function readRoutingConfig(raw, keys) {
  if (!raw) return null;
  try {
    const config = JSON.parse(raw);
    const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000;
    if (![config.userMonthlyMicros, config.requestMicros, config.userMonthlyAttempts].every(positive) ||
        !Array.isArray(config.providers) || config.providers.length < 1 || config.providers.length > Object.keys(providers).length) throw Error();
    const seen = new Set();
    const entries = config.providers.map(entry => {
      const { id, model } = entry;
      if (!Object.hasOwn(providers, id) || seen.has(id) || !keys[id] || typeof model !== 'string' ||
          !/^[a-zA-Z0-9_.:/-]{1,128}$/.test(model) ||
          ![entry.inputPerMillion, entry.outputPerMillion, entry.monthlyMicros, entry.monthlyAttempts, entry.contextTokens].every(positive)) throw Error();
      seen.add(id);
      return { ...entry, label: providers[id] };
    });
    return { ...config, providers: [
      ...entries.filter(entry => entry.id === 'openai'),
      ...entries.filter(entry => entry.id !== 'openai' && entry.id !== 'gemini'),
      ...entries.filter(entry => entry.id === 'gemini'),
    ] };
  } catch {
    console.error('[NOIR] Smart AI Routing configuration is invalid or missing provider credentials.');
    return null;
  }
}

export async function routeGeneration({ config, args, reserve, generate, signal }) {
  let spent = 0;
  let attempts = 0;
  // Bound text conservatively using UTF-8 bytes and chat framing overhead.
  const input = Buffer.byteLength(args.instructions) + args.messages.reduce((sum, message) => sum + Buffer.byteLength(message.text) + 64, 256);
  for (const provider of config.providers) {
    signal.throwIfAborted();
    if (input + args.maxOutputTokens > provider.contextTokens) continue;
    const cost = Math.ceil((input * provider.inputPerMillion + args.maxOutputTokens * provider.outputPerMillion) / 1_000_000);
    if (spent + cost > config.requestMicros) continue;
    if (!await reserve(provider, cost)) continue;
    attempts++;
    spent += cost;
    try {
      const answer = await generate(provider, args);
      console.info('[NOIR routing]', provider.id, 'success', answer.usage.inputTokens, answer.usage.outputTokens, cost);
      return { ...answer, routing: { provider: provider.label, switched: attempts > 1 } };
    } catch (error) {
      console.info('[NOIR routing]', provider.id, 'failure', error instanceof ProviderError ? error.status : 'transport', cost);
      if (signal.aborted || !(error instanceof ProviderError && error.retryable) &&
          !['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(error.cause?.code)) throw error;
    }
  }
  throw Object.assign(new Error(attempts ? 'NOIR could not get a reply from the available AI providers. Try again shortly.' : 'No compatible Smart Routing provider is available within the configured usage limits. You can turn Smart AI Routing off in Settings.'), { status: attempts ? 503 : 429, code: attempts ? 'routing_unavailable' : 'routing_limit' });
}
