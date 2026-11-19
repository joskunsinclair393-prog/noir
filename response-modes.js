const unavailable = () => Object.assign(new Error('Think requires an available free reasoning model. Try Instant instead; NOIR will not switch to paid AI.'), { status: 503, code: 'think_unavailable' });
export function responseMode(value) {
  if (value == null) return 'instant';
  if (!['instant', 'think'].includes(value)) throw Object.assign(new Error('Choose Instant or Think.'), { status: 400, code: 'invalid_response_mode' });
  return value;
}
export function createReasoningResolver(fetchImpl = fetch) {
  let cached, expires = 0, pending;
  return async (preferred = '', signal) => {
    if (!cached || Date.now() >= expires) {
      pending ||= (async () => {
        const response = await fetchImpl('https://openrouter.ai/api/v1/models', { redirect: 'error', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw unavailable();
        const text = await response.text(); if (text.length > 4_000_000) throw unavailable();
        const models = JSON.parse(text).data;
        if (!Array.isArray(models)) throw unavailable();
        cached = models.filter(model => /^[a-z0-9_.-]+\/[a-z0-9_.-]+:free$/i.test(model.id || '') &&
          Number(model.pricing?.prompt) === 0 && Number(model.pricing?.completion) === 0 &&
          model.supported_parameters?.some(param => ['reasoning', 'reasoning.effort'].includes(param)));
        expires = Date.now() + 600_000;
      })().finally(() => { pending = undefined; });
      try { await pending; } catch { throw unavailable(); }
    }
    signal?.throwIfAborted();
    const model = preferred ? cached.find(item => item.id === preferred) : cached[0];
    if (!model) throw unavailable();
    return model.id;
  };
}
