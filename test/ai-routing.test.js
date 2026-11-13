import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAdditional, providerJson, ProviderError, routeGeneration } from '../ai-routing.js';

const provider = id => ({ id, label: id, contextTokens: 10000, inputPerMillion: 10000, outputPerMillion: 10000 });
const args = { instructions: 'Use only the provided sources.', messages: [{ role: 'user', text: 'Page A' }, { role: 'assistant', text: 'Context' }, { role: 'user', text: 'Summarize source https://example.org' }], maxOutputTokens: 80 };
const answer = { text: 'Answer', usage: { inputTokens: 30, outputTokens: 2 } };
const config = { providers: ['openai', 'anthropic', 'deepseek'].map(provider), requestMicros: 1000 };
const route = (overrides = {}) => routeGeneration({ config, args, signal: new AbortController().signal, reserve: async () => true, ...overrides });

test('rate limit switches once with identical history, source text and instructions', async () => {
  const calls = [];
  const result = await route({ generate: async ({ id }, request) => {
    calls.push(id);
    assert.deepEqual(request, args);
    if (id === 'openai') await providerJson(Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }), id);
    return answer;
  } });
  assert.deepEqual(calls, ['openai', 'anthropic']);
  assert.deepEqual(result.routing, { provider: 'anthropic', switched: true });
});

test('refusal, auth failure, and ambiguous transport failure never switch', async () => {
  for (const failure of [new ProviderError(400, 'Declined'), new ProviderError(401, 'Unauthorized'), new TypeError('Fetch failed', { cause: { code: 'UND_ERR_SOCKET' } })]) {
    let calls = 0;
    await assert.rejects(route({ generate: async () => { calls++; throw failure; } }), error => error === failure);
    assert.equal(calls, 1);
  }
});

test('budget denial blocks dispatch; unavailable providers are each tried once', async () => {
  await assert.rejects(route({ reserve: async () => false, generate: async () => assert.fail('Unexpected dispatch') }), { code: 'routing_limit' });
  let calls = 0;
  await assert.rejects(route({ generate: async () => { calls++; throw new ProviderError(503, 'Unavailable', true); } }), { code: 'routing_unavailable' });
  assert.equal(calls, 3);
  await assert.rejects(route({ config: { ...config, requestMicros: 1 }, generate: async () => assert.fail('Over-budget dispatch') }), { code: 'routing_limit' });
});

test('text adapters submit text to official endpoints and report actual usage', async () => {
  for (const id of ['deepseek', 'anthropic', 'mistral']) {
    const claude = id === 'anthropic';
    const result = await generateAdditional(id, { ...args, model: 'mock-model', apiKey: 'private-key',
      fetchImpl: async (url, init) => {
        assert.equal(url, claude ? 'https://api.anthropic.com/v1/messages' : id === 'mistral' ? 'https://api.mistral.ai/v1/chat/completions' : 'https://api.deepseek.com/chat/completions');
        assert.equal(claude ? init.headers['x-api-key'] : init.headers.authorization, claude ? 'private-key' : 'Bearer private-key');
        assert.match(init.body, /https:\/\/example.org/);
        return Response.json(claude ? { content: [{ type: 'text', text: 'Answer' }], usage: { input_tokens: 29, cache_read_input_tokens: 1, output_tokens: 2 } } :
          { choices: [{ message: { content: 'Answer' } }], usage: { prompt_tokens: 30, completion_tokens: 2 } });
      },
    });
    assert.deepEqual(result, { text: 'Answer', usage: { ...answer.usage, totalTokens: 32 } });
  }
});
