import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoogleConnectors } from '../google-connectors.js';

test('Google grants require a bound callback and stay encrypted and isolated by account', async () => {
  const rows = new Map();
  let verifier;
  const request = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    assert.equal(options.redirect, 'error');
    if (url.hostname === 'oauth2.googleapis.com') {
      const exchange = options.body.get('grant_type') === 'authorization_code';
      if (exchange) verifier = options.body.get('code_verifier');
      else assert.equal(options.body.get('refresh_token'), 'private-refresh');
      return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', scope: 'https://www.googleapis.com/auth/drive.metadata.readonly' });
    }
    if (url.hostname === 'www.googleapis.com') {
      assert.equal(options.headers.authorization, 'Bearer private-access');
      return Response.json({ files: [{ name: 'Budget', mimeType: 'text/plain' }] });
    }
    assert.equal(url.hostname, 'auth.example.test');
    if (options.method === 'POST') {
      const row = JSON.parse(options.body);
      assert.notEqual(row.refresh_ciphertext, 'private-refresh');
      rows.set(row.user_id, row);
      return new Response(null, { status: 204 });
    }
    const user = url.searchParams.get('user_id').slice(3);
    if (options.method === 'DELETE') {
      rows.delete(user);
      return new Response(null, { status: 204 });
    }
    return Response.json(rows.has(user) ? [rows.get(user)] : []);
  };
  const api = createGoogleConnectors({
    config: { authRequired: true, supabaseUrl: 'https://auth.example.test', supabaseServiceRoleKey: 'private-service-key' },
    env: { GOOGLE_CONNECTOR_CLIENT_ID: 'client', GOOGLE_CONNECTOR_CLIENT_SECRET: 'secret', CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64') },
    request,
  });
  const name = 'Google Drive';
  const { state, url } = api.start('alice', name);
  assert.equal(new URL(url).searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.metadata.readonly');
  assert.equal(new URL(url).searchParams.get('code_challenge_method'), 'S256');
  assert.equal(await api.complete(state, 'x'.repeat(43), 'code'), false);
  assert.equal(await api.complete(state, state, 'code'), true);
  assert.match(verifier, /^[\w-]{43}$/);
  assert.equal(await api.complete(state, state, 'code'), false);
  assert.equal((await api.status('alice', [name]))[name].connected, true);
  assert.equal((await api.status('bob', [name]))[name].connected, false);
  await assert.rejects(api.read('bob', name), /Connect this service/);
  assert.deepEqual(await api.read('alice', name), [['Budget', 'text/plain', '']]);
  await api.disconnect('alice', name);
  assert.equal((await api.status('alice', [name]))[name].connected, false);
});
