import { readerURL, readableText, readPublicPage } from './page-reader.js';

function robotsAllows(text, url) {
  // Treat matching rules conservatively, including wildcard rules.
  const path = new URL(url).pathname + new URL(url).search;
  let agents = [];
  let hasRules = false;
  let allowLength = -1;
  let blockLength = -1;
  for (const line of text.split('\n')) {
    const match = /^\s*(user-agent|allow|disallow)\s*:\s*([^#]*?)\s*(?:#.*)?$/i.exec(line);
    if (!match) continue;
    const [, field, value] = match;
    if (field.toLowerCase() === 'user-agent') {
      if (hasRules) agents = [];
      hasRules = false;
      agents.push(value.toLowerCase());
      continue;
    }
    hasRules = true;
    if (!value || !agents.some(agent => agent === '*' || (agent && 'noir-public-page-reader'.startsWith(agent)))) continue;
    const end = value.endsWith('$');
    const rule = end ? value.slice(0, -1) : value;
    const pieces = rule.split('*');
    if (!path.startsWith(pieces[0])) continue;
    let cursor = pieces[0].length;
    let matches = true;
    for (const piece of pieces.slice(1)) {
      const next = path.indexOf(piece, cursor);
      if (next < 0) { matches = false; break; }
      cursor = next + piece.length;
    }
    if (!matches || (end && !path.endsWith(pieces.at(-1)))) continue;
    if (field.toLowerCase() === 'allow') allowLength = Math.max(allowLength, rule.length);
    else blockLength = Math.max(blockLength, rule.length);
  }
  return blockLength < 0 || allowLength >= blockLength;
}

export async function exploreWebsite(start, question, { limit = 5, read = readPublicPage, signal, onPage = () => {} } = {}) {
  limit = Math.max(1, Math.min(5, Math.floor(limit) || 5));
  const root = readerURL(start);
  const scope = root.origin;
  const deadline = AbortSignal.timeout(25000);
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const robots = await read(scope + '/robots.txt', { scope, signal: stop, robots: true });
  const terms = question.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const queue = [{ url: root.href, title: 'Starting page', depth: 0, score: 0 }];
  const seen = new Set([root.href]);
  const pages = [];
  const failures = [];
  for (let attempt = 0; queue.length && attempt < limit; attempt++) {
    stop.throwIfAborted();
    queue.sort((a, b) => b.score - a.score);
    const entry = queue.shift();
    onPage({ ...entry, state: 'checking' });
    try {
      const page = await read(entry.url, { scope, signal: stop, allowURL: url => robotsAllows(robots.text, url) });
      stop.throwIfAborted();
      const title = readableText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(page.html)?.[1] || entry.title).slice(0, 150) || 'Public page';
      if (!pages.some(item => item.url === page.url)) pages.push({ url: page.url, title, text: page.text.slice(0, 2200) });
      seen.add(page.url);
      onPage({ ...entry, title, state: 'complete' });
      if (entry.depth >= 2) continue;
      const markup = page.html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
      for (const match of markup.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
        let link;
        try { link = readerURL(new URL(match[2].replace(/&amp;/gi, '&'), page.url).href); } catch { continue; }
        if (link.origin !== scope || seen.has(link.href) || seen.size >= 120) continue;
        seen.add(link.href);
        const label = readableText(match[3]).slice(0, 150) || link.pathname;
        const searchable = (label + ' ' + link.pathname).toLowerCase();
        const score = terms.filter(term => searchable.includes(term)).length;
        queue.push({ url: link.href, title: label, depth: entry.depth + 1, score });
      }
    } catch {
      stop.throwIfAborted();
      failures.push(entry.url);
      onPage({ ...entry, state: 'failed' });
    }
  }
  return { pages, failures };
}
