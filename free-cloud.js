// Use OpenRouter's explicit free router. Client input cannot select a paid model.
import { providerJson, ProviderError } from './ai-routing.js';

export async function generateFreeCloud({ apiKey, messages, instructions, maxOutputTokens, onText, fetchImpl = fetch }) {
  if (messages.some(message => message.attachments?.length)) throw new ProviderError(400, 'The free cloud model accepts text only.');
  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'system', content: instructions }, ...messages.map(({ role, text }) => ({ role, content: text }))],
      max_tokens: Math.min(1024, maxOutputTokens),
      stream: Boolean(onText),
    }),
  });
  const data = onText && response.ok ? await readFreeStream(response, onText) : await providerJson(response, 'openrouter');
  const text = data.choices?.[0]?.message?.content;
  const inputTokens = data.usage?.prompt_tokens;
  const outputTokens = data.usage?.completion_tokens;
  if (typeof text !== 'string' || !text.trim() ||
      ![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new ProviderError(502, 'The free cloud model returned an incomplete reply.');
  }
  return { text: text.trim(), usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } };
}

async function readFreeStream(response, onText) {
  const invalid = () => new ProviderError(502, 'The free cloud model returned an incomplete stream.');
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw invalid();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage;
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.byteLength;
    if (size > 2 * 1024 * 1024) throw invalid();
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return { choices: [{ message: { content: text } }], usage };
      let frame;
      try { frame = JSON.parse(payload); } catch { throw invalid(); }
      if (frame?.error || frame?.choices?.[0]?.finish_reason === 'error') throw invalid();
      if (frame?.usage) usage = frame.usage;
      const delta = frame?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        text += delta;
        if (text.length > 48000) throw invalid();
        onText(delta);
      }
    }
  }
  throw invalid();
}
