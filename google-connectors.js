import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const prefix = 'https://www.googleapis.com/auth/';
const definitions = {
  'Google Drive': { scope: prefix + 'drive.metadata.readonly', permissions: 'Read file names and metadata', endpoint: () => 'https://www.googleapis.com/drive/v3/files?pageSize=10&orderBy=modifiedTime%20desc&fields=files(name,mimeType,modifiedTime)&q=trashed%20%3D%20false', rows: data => data.files?.map(item => [item.name, item.mimeType, item.modifiedTime]) },
  'Google Calendar': { scope: prefix + 'calendar.events.readonly', permissions: 'Read upcoming events from your primary calendar', endpoint: () => 'https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=10&timeMin=' + encodeURIComponent(new Date().toISOString()), rows: data => data.items?.map(item => [item.summary, item.start?.dateTime || item.start?.date, item.end?.dateTime || item.end?.date]) },
  Gmail: { scope: prefix + 'gmail.metadata', permissions: 'Read recent inbox subject, sender, and date headers', endpoint: () => 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=5', rows: data => data.rows },
};

const fail = (status, message) => Object.assign(new Error(message), { status, code: 'connector_error' });
const challenge = value => createHash('sha256').update(value).digest('base64url');
const stateFormat = /^[A-Za-z0-9_-]{43}$/;
const service = name => Object.hasOwn(definitions, name) ? definitions[name] : null;

export function createGoogleConnectors({ config, env = process.env, request = fetch }) {
  const clientId = env.GOOGLE_CONNECTOR_CLIENT_ID;
  const clientSecret = env.GOOGLE_CONNECTOR_CLIENT_SECRET;
  const key = Buffer.from(env.CONNECTOR_ENCRYPTION_KEY || '', 'base64');
  let callback;
  try {
    const base = new URL(env.PUBLIC_APP_URL || 'https://noir-buhz.onrender.com');
    if (base.protocol === 'https:' && !base.username && !base.password) callback = new URL('/oauth/google/connectors', base).href;
  } catch {}
  const configured = Boolean(clientId && clientSecret && key.length === 32 && callback && config.authRequired && config.supabaseUrl && config.supabaseServiceRoleKey);
  const attempts = new Map();
  const writes = new Map();
  async function serialize(userId, name, fn) {
    const id = JSON.stringify([userId, name]);
    const previous = writes.get(id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(fn);
    writes.set(id, pending);
    try { return await pending; }
    finally { if (writes.get(id) === pending) writes.delete(id); }
  }

  async function checkedFetch(url, options = {}, error = 'The connector service is temporarily unavailable.') {
    let response;
    try { response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
    catch { throw fail(503, error); }
    if (!response.ok) throw fail([400, 401, 403].includes(response.status) ? 403 : 503, error);
    return response;
  }
  function crypt(userId, name, value, decrypt = false) {
    const aad = Buffer.from(JSON.stringify([userId, name]));
    if (decrypt) {
      const bytes = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAAD(aad);
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }
  async function db(userId, name, method = 'GET', body) {
    const query = new URLSearchParams({ user_id: 'eq.' + userId, ...(name && { connector: 'eq.' + name }) });
    if (method === 'GET') query.set('select', name ? 'refresh_ciphertext' : 'connector');
    const reply = await checkedFetch(config.supabaseUrl + '/rest/v1/noir_connector_grants?' + (method === 'POST' ? 'on_conflict=user_id,connector' : query), {
      method, headers: { apikey: config.supabaseServiceRoleKey, authorization: 'Bearer ' + config.supabaseServiceRoleKey,
        ...(body && { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }) },
      ...(body && { body: JSON.stringify(body) }),
    }, 'NOIR could not access connector storage.');
    return method === 'GET' ? reply.json() : undefined;
  }
  async function token(fields) {
    const reply = await checkedFetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }),
    }, 'Google could not authorize this connector. Try connecting it again.');
    const data = await reply.json();
    if (typeof data.access_token !== 'string' || !data.access_token) throw fail(403, 'Google did not grant access.');
    return data;
  }
  function requireService(userId, name) {
    if (!userId) throw fail(401, 'Sign in to manage connectors.');
    const definition = service(name);
    if (!configured || !definition) throw fail(503, 'This connector is not configured.');
    return definition;
  }
  return {
    async status(userId, names) {
      if (!configured || !userId) return null;
      let rows;
      try { rows = await db(userId); }
      catch { return Object.fromEntries(names.filter(service).map(name => [name, { ready: false, connected: false, reason: 'storage_unavailable' }])); }
      return Object.fromEntries(names.filter(service).map(name => [name, { ready: true, connected: rows.some(row => row.connector === name), permissions: [definitions[name].permissions] }]));
    },
    start(userId, name) {
      const definition = requireService(userId, name);
      const now = Date.now();
      for (const [state, pending] of attempts) if (pending.expires <= now) attempts.delete(state);
      if (attempts.size >= 200 || [...attempts.values()].filter(item => item.userId === userId).length >= 5) throw fail(429, 'Wait before starting another connection.');
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      attempts.set(state, { userId, name, verifier, expires: now + 600_000 });
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code',
        scope: definition.scope, state, code_challenge: challenge(verifier), code_challenge_method: 'S256',
        access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false' });
      return { state, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params };
    },
    async complete(state, cookie, code) {
      if (!configured || !stateFormat.test(state || '') || !stateFormat.test(cookie || '') ||
          !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return false;
      const pending = attempts.get(state);
      attempts.delete(state);
      if (!pending || pending.expires <= Date.now() || typeof code !== 'string' || !code || code.length > 4096) return false;
      const { userId, name, verifier } = pending;
      return serialize(userId, name, async () => {
        const grant = await token({ code, code_verifier: verifier, redirect_uri: callback, grant_type: 'authorization_code' });
        if (!String(grant.scope || '').split(/\s+/).includes(definitions[name].scope) || typeof grant.refresh_token !== 'string' || !grant.refresh_token) return false;
        await db(userId, name, 'POST', { user_id: userId, connector: name, refresh_ciphertext: crypt(userId, name, grant.refresh_token) });
        return true;
      });
    },
    async disconnect(userId, name) {
      requireService(userId, name);
      for (const [state, pending] of attempts) if (pending.userId === userId && pending.name === name) attempts.delete(state);
      await serialize(userId, name, () => db(userId, name, 'DELETE'));
    },
    async read(userId, name) {
      const definition = requireService(userId, name);
      const [row] = await db(userId, name);
      if (!row) throw fail(404, 'Connect this service first.');
      const grant = await token({ grant_type: 'refresh_token', refresh_token: crypt(userId, name, row.refresh_ciphertext, true) });
      const get = async url => (await checkedFetch(url, { headers: { authorization: 'Bearer ' + grant.access_token } },
        'Google could not read this service. Check the granted permission or reconnect.')).json();
      const data = await get(definition.endpoint());
      if (name === 'Gmail') {
        const ids = (data.messages || []).map(item => item.id).filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(id)).slice(0, 5);
        data.rows = await Promise.all(ids.map(async id => {
          const message = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date');
          return ['Subject', 'From', 'Date'].map(header => message.payload?.headers?.find(item => item.name?.toLowerCase() === header.toLowerCase())?.value);
        }));
      }
      return (definition.rows(data) || []).slice(0, 10).map(row => row.map(value => String(value || '').replace(/[\x00-\x1f]/g, ' ').slice(0, 180)));
    },
  };
}
