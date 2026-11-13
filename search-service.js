export async function searchPublicWeb(query, { signal, enabled, apiKey, fetchImpl = fetch }) {
  if (!enabled || !apiKey) throw Object.assign(new Error('Web Search is not configured. The site owner must add a Brave Search API key and enable this paid-capable feature.'), { status: 503, code: 'plugin_not_configured' });
  const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
  endpoint.searchParams.set('q', query.slice(0, 400));
  endpoint.searchParams.set('count', '5');
  endpoint.searchParams.set('safesearch', 'moderate');
  let response;
  try {
    response = await fetchImpl(endpoint, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000), headers: { accept: 'application/json', 'x-subscription-token': apiKey } });
  } catch {
    throw Object.assign(new Error('Web Search could not reach its search provider. Try again shortly.'), { status: 502, code: 'plugin_provider_unavailable' });
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(response.status === 429 ? 'Web Search reached its provider rate limit. Try again later.' : 'Web Search could not complete this search. Check its provider configuration.'), { status: response.status === 429 ? 429 : 502, code: 'plugin_provider_error' });
  const results = (Array.isArray(data?.web?.results) ? data.web.results : []).slice(0, 5).flatMap(item => {
    try {
      const link = new URL(item.url);
      if (link.protocol !== 'https:') return [];
      return [{ title: String(item.title || link.hostname).slice(0, 180), url: link.href, description: String(item.description || '').slice(0, 1200) }];
    } catch { return []; }
  });
  return results;
}

