import test from 'node:test';
import assert from 'node:assert/strict';
import { researchPublicWeb } from '../research-agent.js';

test('research searches again when coverage is thin and compares retrieved pages', async () => {
  const queries = [];
  const visited = [];
  const controller = new AbortController();
  const result = await researchPublicWeb({
    question: 'Find three affordable laptops in Australia',
    signal: controller.signal,
    onPage() {},
    search: async query => {
      queries.push(query);
      return (queries.length === 1 ? ['a', 'blocked'] : ['b', 'c', 'd']).map(name => ({ url: 'https://example.com/' + name }));
    },
    read: async (url, options) => {
      if (options.robots) return { text: '' };
      visited.push(url);
      if (url.endsWith('/blocked')) throw new Error('Blocked');
      return { url, text: 'Retrieved laptop information', html: '<title>Laptop</title>' };
    },
  });
  assert.equal(queries.length, 2);
  assert.equal(visited.length, 5);
  assert.equal(result.pages.length, 4);
  assert.equal(result.failures.length, 1);
});

test('explicit public website questions stay within the website and cancellation stops reads', async () => {
  for (const question of ['Check this public website for upcoming events', 'Find contact information at https://example.com/', 'Summarize the latest announcements on this website']) {
    const controller = new AbortController();
    const visited = [];
    const result = await researchPublicWeb({
      start: 'https://example.com/', question, signal: controller.signal, onPage() {},
      search: async () => assert.fail('Search was not needed'),
      read: async (url, options) => {
        if (options.robots) return { text: '' };
        visited.push(url);
        return { url, text: 'Public information', html: '<a href="/events">Events</a><a href="https://elsewhere.example/">External</a>' };
      },
    });
    assert.equal(result.pages.length, 2);
    assert.ok(visited.every(url => url.startsWith('https://example.com/')));
  }
  const controller = new AbortController();
  await assert.rejects(researchPublicWeb({
    question: 'Find laptops', signal: controller.signal, onPage() {},
    search: async () => { controller.abort(); return [{ url: 'https://example.com/' }]; },
    read: async () => assert.fail('Read ran after stop'),
  }), { name: 'AbortError' });
});
