import { readerURL } from './page-reader.js';
import { exploreWebsite } from './website-explorer.js';

// Only these read-only tools are available. Retrieved content cannot add tools or change limits.
export async function researchPublicWeb({ question, start, search, read, signal, onPage }) {
  const stop = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  const pages = [];
  const failures = [];
  const visited = new Set();
  let remaining = 5;
  let searches = 0;
  const explicit = question.match(/https:\/\/[^\s<>"']+/i)?.[0]?.replace(/[.,;)]+$/, '');
  const refersToSite = /\b(?:this|current) (?:public )?(?:website|site|page)\b/i.test(question);
  const seed = explicit || (refersToSite ? start : null);
  if (!seed && /\b(?:my|our) (?:son['’]s |daughter['’]s |child['’]s )?school\b/i.test(question)) throw new Error('Include the school name and location or its public HTTPS address.');
  if (refersToSite && !seed) throw new Error('Enter the website address first, or include its HTTPS URL in your question.');

  async function inspect(value, limit) {
    let url;
    try { url = readerURL(value).href; } catch { return; }
    if (visited.has(url) || remaining <= 0 || stop.aborted) return;
    visited.add(url);
    // Reserve the maximum visits up front, including unsuccessful visits.
    const budget = Math.min(limit, remaining);
    remaining -= budget;
    try {
      const result = await exploreWebsite(url, question, { limit: budget, read, signal: stop, onPage });
      for (const page of result.pages) {
        visited.add(page.url);
        if (!pages.some(item => item.url === page.url)) pages.push(page);
      }
      failures.push(...result.failures);
    } catch {
      if (signal.aborted) signal.throwIfAborted();
      failures.push(url);
      onPage({ url, title: new URL(url).hostname, state: 'failed' });
    }
  }

  onPage({ url: 'plan', title: seed ? 'Plan: read the requested site and relevant links' : 'Plan: search and compare public sources', state: 'complete' });
  if (seed) await inspect(seed, 5);
  else {
    for (const query of [question, question + ' official details']) {
      if (stop.aborted || remaining <= 0) break;
      const id = 'search-' + (++searches);
      onPage({ url: id, title: 'Searching the web', state: 'checking' });
      try {
        const results = await search(query, stop);
        onPage({ url: id, title: 'Search finished', state: 'complete' });
        const batch = results.slice(0, searches === 1 ? 3 : 5);
        for (const result of batch) await inspect(result.url, 1);
      } catch (error) {
        if (signal.aborted) signal.throwIfAborted();
        onPage({ url: id, title: 'Search unavailable', state: 'failed' });
        if (!pages.length) throw error;
        break;
      }
      if (pages.length >= 3) break;
    }
  }
  signal.throwIfAborted();
  return { pages, failures };
}
