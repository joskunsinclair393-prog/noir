import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export const PAGE_UNAVAILABLE = 'NOIR cannot access this webpage yet. This website may restrict automated access or require browser integration.';

export function publicIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a) &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113);
}

export function readerURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw new Error(PAGE_UNAVAILABLE);
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw new Error(PAGE_UNAVAILABLE); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !host.includes('.') || isIP(host) || /\.(?:local|localhost|internal|test|invalid|onion|home|lan)$/.test(host) ||
      /(?:^|\/)(?:login|signin|sign-in|oauth|sso|portal|account|auth)(?:\/|$)/i.test(pathname) ||
      [...url.searchParams.keys()].some(key => /token|password|session|signature|secret|auth|^key$|^code$|credential|api.?key|^state$/i.test(key))) {
    throw new Error(PAGE_UNAVAILABLE);
  }
  url.hash = '';
  return url;
}

function pinnedRequest(url, ip, signal) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', signal, agent: false, family: 4,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address: ip, family: 4 }])
        : callback(null, ip, 4),
      headers: { accept: 'text/html, text/plain', 'accept-encoding': 'identity', 'user-agent': 'NOIR-Public-Page-Reader/1.0' },
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

export function readableText(html) {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|template|noscript|iframe|svg|head|form|nav|footer|aside)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi, (all, numeric, name) => {
      if (!numeric) return ({ amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' })[name.toLowerCase()] ?? all;
      const code = /^x/i.test(numeric) ? parseInt(numeric.slice(1), 16) : Number(numeric);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
}

export async function readPublicPage(value, { resolveHost = lookup, transport = pinnedRequest, scope, signal: cancellation, robots = false, allowURL } = {}) {
  cancellation?.throwIfAborted();
  let url = readerURL(value);
  const deadline = AbortSignal.timeout(8000);
  const signal = cancellation ? AbortSignal.any([deadline, cancellation]) : deadline;
  const visited = new Set();
  let abort;
  const timeout = new Promise((_, reject) => {
    abort = () => reject(new Error(PAGE_UNAVAILABLE));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([timeout, (async () => {
      for (let hop = 0; hop <= 3; hop++) {
        if ((scope && url.origin !== scope) || (allowURL && !allowURL(url.href))) throw new Error(PAGE_UNAVAILABLE);
        signal.throwIfAborted();
        if (visited.has(url.href)) throw new Error(PAGE_UNAVAILABLE);
        visited.add(url.href);
        const records = await resolveHost(url.hostname, { all: true, family: 4, verbatim: true });
        if (!records.length || records.some(record => !publicIPv4(record.address))) throw new Error(PAGE_UNAVAILABLE);
        signal.throwIfAborted();
        const response = await transport(url, records[0].address, signal);
        if (robots && [404, 410].includes(response.statusCode)) { response.destroy(); return { text: '' }; }
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.destroy();
          if (!response.headers.location || hop === 3) throw new Error(PAGE_UNAVAILABLE);
          url = readerURL(new URL(response.headers.location, url).href);
          continue;
        }
        if (response.statusCode !== 200 || !(robots ? /^text\/plain(?:\s*;|$)/i : /^text\/html(?:\s*;|$)/i).test(response.headers['content-type'] || '') ||
            !['', 'identity'].includes(response.headers['content-encoding'] || '') ||
            Number(response.headers['content-length']) > 400000) {
          response.destroy();
          throw new Error(PAGE_UNAVAILABLE);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > 400000) { response.destroy(); throw new Error(PAGE_UNAVAILABLE); }
          chunks.push(chunk);
        }
        const html = Buffer.concat(chunks).toString('utf8');
        if (robots) return { text: html };
        const text = readableText(html);
        if (!text) throw new Error(PAGE_UNAVAILABLE);
        return { url: url.href, text, ...(scope ? { html } : {}) };
      }
      throw new Error(PAGE_UNAVAILABLE);
    })()]);
  } finally { signal.removeEventListener('abort', abort); }
}
