import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { resolveAddress } from '../browser.js';
import { readPublicPage } from '../page-reader.js';

test('address bar distinguishes HTTPS navigation from encoded searches', () => {
  const origin = 'https://noir.example';
  for (const input of ['example.com','https://example.com']) assert.equal(resolveAddress(input, origin).url, 'https://example.com/');
  for (const input of ['best gaming laptops','school calendar 2026','laptops, under $1,000?']) assert.equal(new URL(resolveAddress(input, origin).url).searchParams.get('q'), input);
  for (const input of ['javascript:alert(1)','data:text/html,hi','file:///tmp/a','http://example.com']) assert.throws(() => resolveAddress(input, origin));
});

function response(statusCode, headers, body = '') {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers });
}

test('reader extracts text and blocks private DNS, redirects and non-HTML', async () => {
  const resolveHost = async host => [{ address: host === 'internal.example' ? '10.0.0.1' : '93.184.215.14' }];
  const url = 'https://example.com';
  const result = await readPublicPage(url, { resolveHost, transport: async (_, ip) => {
    assert.equal(ip, '93.184.215.14');
    return response(200, { 'content-type': 'text/html' }, '<main>Calendar &amp; dates<script>bad()</script></main>');
  }});
  assert.equal(result.text, 'Calendar & dates');
  for (const address of ['https://127.0.0.1','https://169.254.169.254','https://[::1]','file:///etc/passwd','https://internal.example']) {
    await assert.rejects(readPublicPage(address, { resolveHost, transport: async () => assert.fail('Unsafe connection') }));
  }
  for (const location of ['http://example.com','https://internal.example','https://example.com/login']) {
    let requests = 0;
    await assert.rejects(readPublicPage(url, { resolveHost, transport: async () => {
      assert.equal(++requests, 1);
      return response(302, { location });
    }}));
    assert.equal(requests, 1);
  }
  await assert.rejects(readPublicPage(url, { resolveHost, transport: async () => response(401, {'content-type':'text/html'}, 'private') }));
  await assert.rejects(readPublicPage(url, { resolveHost, transport: async () => response(200, {'content-type':'application/json'}, '{}') }));
});

test('exploration ranks same-origin links, honors robots, bounds depth and cancels', async () => {
  const { exploreWebsite } = await import('../website-explorer.js');
  const root = 'https://example.com';
  const visited = [];
  const html = {
    '/': '<a href="/about">About</a><a href="/events">Events</a><a href="/blocked">Events</a><a href="https://other.example.com/">Events</a>',
    '/events': '<a href="/calendar">Calendar events</a>',
    '/calendar': '<a href="/deep">More events</a>',
  };
  const read = async (url, options) => {
    if (options.robots) return { text: 'User-agent: *\nDisallow: /blocked' };
    if (!options.allowURL(url)) throw Error('Blocked by robots');
    const path = new URL(url).pathname;
    visited.push(path);
    return { url, text: path, html: html[path] || '' };
  };
  const result = await exploreWebsite(root, 'Find events', { read });
  assert.deepEqual(visited.slice(0,3), ['/', '/events', '/calendar']);
  assert.ok(!visited.includes('/deep'));
  assert.equal(result.failures[0], root + '/blocked');
  assert.equal((await exploreWebsite(root, 'events', { read, limit: 2 })).pages.length, 2);
  const controller = new AbortController();
  await assert.rejects(exploreWebsite(root, 'events', {
    read, signal: controller.signal, onPage: () => controller.abort(),
  }));
});
