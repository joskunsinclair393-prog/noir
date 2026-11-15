// Use OpenRouter's explicit free router. Client input cannot select a paid model.
import { providerJson, ProviderError } from './ai-routing.js';

export async function generateFreeCloud({ apiKey, messages, instructions, maxOutputTokens, fetchImpl = fetch }) {
  if (messages.some(message => message.attachments?.length)) throw new ProviderError(400, 'The free cloud model accepts text only.');
  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'system', content: instructions }, ...messages.map(({ role, text }) => ({ role, content: text }))],
      max_tokens: Math.min(1024, maxOutputTokens),
      stream: false,
    }),
  });
  const data = await providerJson(response, 'openrouter');
  const text = data.choices?.[0]?.message?.content;
  const inputTokens = data.usage?.prompt_tokens;
  const outputTokens = data.usage?.completion_tokens;
  if (typeof text !== 'string' || !text.trim() ||
      ![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new ProviderError(502, 'The free cloud model returned an incomplete reply.');
  }
  return { text: text.trim(), usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } };
}
