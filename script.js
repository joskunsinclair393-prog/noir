(() => {
  const $ = id => document.getElementById(id);
  const input = $('prompt');
  const messages = $('messages');
  const pickedFiles = [];
  const selectedIntegrations = new Map();
  const fileInput = $('fileInput');
  const imageInput = $('imageInput');
  const attachButton = $('attachButton');
  const attachMenu = $('attachMenu');
  const numberFormat = new Intl.NumberFormat();
  const app = document.querySelector('.app');
  const authGate = $('authGate');
  const authStorageKey = 'noirAuthSession';
  let authConfig = null;
  let authSession = readAuthSession();
  let createAccountMode = false;
  app.hidden = true;
  let activeChatId = null;
  let chats = [];
  let sessionInfo = null;
  let sending = false;

  function readAuthSession() {
    try { return JSON.parse(localStorage.getItem(authStorageKey) || 'null'); } catch { return null; }
  }
  function saveAuthSession(session) {
    authSession = session;
    try { session ? localStorage.setItem(authStorageKey, JSON.stringify(session)) : localStorage.removeItem(authStorageKey); } catch {}
  }
  function setAuthFeedback(text, success = false) {
    const feedback = $('authFeedback');
    feedback.textContent = text;
    feedback.classList.toggle('is-success', success);
  }
  async function refreshAuthSession() {
    if (!authConfig?.configured || !authSession?.refresh_token) return false;
    try {
      const response = await fetch(`${authConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: authConfig.supabaseAnonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: authSession.refresh_token }),
      });
      const data = await response.json();
      if (!response.ok || !data.access_token) { saveAuthSession(null); return false; }
      saveAuthSession(data);
      return true;
    } catch { return false; }
  }
  async function authRequest(path, body) {
    const response = await fetch(`${authConfig.supabaseUrl}/auth/v1/${path}`, {
      method: 'POST', headers: { apikey: authConfig.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || 'Sign-in failed. Check your details and try again.');
    return data;
  }
  function randomVerifier() {
    const bytes = crypto.getRandomValues(new Uint8Array(48));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function startOAuth(provider) {
    if (!authConfig?.configured) { setAuthFeedback('Sign-in is not configured yet. The site owner must finish the authentication setup.'); return; }
    try {
      const verifier = randomVerifier();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem('noirOAuthVerifier', verifier);
      const url = new URL(`${authConfig.supabaseUrl}/auth/v1/authorize`);
      url.searchParams.set('provider', provider);
      url.searchParams.set('redirect_to', location.origin + location.pathname);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 's256');
      url.searchParams.set('flow_type', 'pkce');
      location.assign(url.toString());
    } catch { setAuthFeedback('Could not start secure sign-in. Please try again.'); }
  }
  async function completeAuthSession(data) {
    if (!data?.access_token) return false;
    saveAuthSession(data);
    authGate.hidden = true;
    app.hidden = false;
    setAuthFeedback('');
    try { await loadChatApp(); }
    catch (error) { app.hidden = true; authGate.hidden = false; throw error; }
    return true;
  }
  async function finishOAuthCallback() {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (oauthError) {
      history.replaceState({}, '', location.pathname);
      localStorage.removeItem('noirOAuthVerifier');
      const friendlyError = /provider is not enabled|unsupported provider/i.test(oauthError)
        ? 'Google sign-in is not enabled in NOIR’s Supabase settings yet. The site owner must enable Google and add its OAuth client credentials.'
        : oauthError;
      setAuthFeedback(friendlyError);
      return false;
    }
    if (!code) return false;
    history.replaceState({}, '', location.pathname);
    const verifier = localStorage.getItem('noirOAuthVerifier');
    localStorage.removeItem('noirOAuthVerifier');
    if (!verifier) { setAuthFeedback('That sign-in link expired. Please try again.'); return false; }
    try {
      const data = await authRequest('token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
      return await completeAuthSession(data);
    } catch (error) { setAuthFeedback(error.message); return false; }
  }
  async function showAuthScreen() {
    app.hidden = true;
    authGate.hidden = false;
    $('profileWrap').hidden = true;
    $('profileSignOut').hidden = true;
    if (!authConfig?.configured) {
      setAuthFeedback('Account sign-in is not configured yet. The site owner must add the Supabase project URL and public key, then enable Google, Apple, or GitHub in the provider settings.');
      document.querySelectorAll('.auth-provider, #authSubmit, #authEmail, #authPassword').forEach(control => { control.disabled = true; });
    } else {
      document.querySelectorAll('.auth-provider, #authSubmit, #authEmail, #authPassword').forEach(control => { control.disabled = false; });
    }
  }

  document.querySelectorAll('[data-oauth]').forEach(button => button.addEventListener('click', () => startOAuth(button.dataset.oauth)));
  $('authModeToggle').addEventListener('click', () => {
    createAccountMode = !createAccountMode;
    $('authTitle').textContent = createAccountMode ? 'Create your account' : 'Welcome to NOIR';
    $('authSubmit').textContent = createAccountMode ? 'Create account' : 'Sign in';
    $('authModeToggle').textContent = createAccountMode ? 'Sign in instead' : 'Create an account';
    $('authPassword').autocomplete = createAccountMode ? 'new-password' : 'current-password';
    setAuthFeedback('');
  });
  $('authForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('authSubmit');
    submit.disabled = true;
    setAuthFeedback(createAccountMode ? 'Creating your account…' : 'Signing in…', true);
    try {
      const email = $('authEmail').value.trim();
      const password = $('authPassword').value;
      if (createAccountMode && password.length < 8) throw new Error('Use a password with at least 8 characters.');
      const data = createAccountMode
        ? await authRequest('signup', { email, password })
        : await authRequest('token?grant_type=password', { email, password });
      if (data.access_token) await completeAuthSession(data);
      else setAuthFeedback('Check your email to confirm your new account, then return here to sign in.', true);
    } catch (error) { setAuthFeedback(error.message); }
    finally { submit.disabled = !authConfig?.configured; }
  });
  $('profileSignOut').addEventListener('click', async () => {
    if (authConfig?.configured && authSession?.access_token) {
      try { await fetch(`${authConfig.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: authConfig.supabaseAnonKey, authorization: `Bearer ${authSession.access_token}` } }); } catch {}
    }
    saveAuthSession(null);
    startNewChat(false);
    showAuthScreen();
  });

  async function api(path, options = {}) {
    const request = () => fetch(path, {
      credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(authSession?.access_token ? { authorization: `Bearer ${authSession.access_token}` } : {}), ...(options.headers || {}) },
    });
    let response = await request();
    if (response.status === 401 && path !== '/api/auth-config' && await refreshAuthSession()) response = await request();
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status, code: data.code });
    return data;
  }

  function showNotice(text, visible = true) {
    const notice = $('appNotice');
    notice.textContent = text;
    notice.hidden = !visible;
  }

  function updateSession(data) {
    sessionInfo = data;
    const usage = data.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    $('profileLifetimeTokens').textContent = numberFormat.format(usage.totalTokens || 0);
    $('profileDailyTokens').textContent = numberFormat.format(data.dailyTokens || 0);
    $('creditsPanel').hidden = !data.creditsEnabled;
    if (data.creditsEnabled) $('creditBalance').textContent = data.creditsUnlimited ? 'Unlimited' : numberFormat.format(data.credits || 0);

    if (data.provider.ready) showNotice('', false);
    else if (!data.provider.keyConfigured) showNotice('NOIR’s AI service is not configured yet. Please try again later.');
    else if (!data.provider.requestsEnabled) showNotice('AI requests are temporarily unavailable. Please try again later.');
    else showNotice('NOIR could not connect to its AI service. Please try again later.');
  }

  function rememberActiveChat(id) {
    try { id ? localStorage.setItem('noirActiveChatId', id) : localStorage.removeItem('noirActiveChatId'); } catch {}
  }
  function getRememberedChat() {
    try { return localStorage.getItem('noirActiveChatId'); } catch { return null; }
  }

  function renderChatHistory() {
    const list = $('chatHistory');
    list.replaceChildren();
    [...chats].sort((a, b) => b.updatedAt - a.updatedAt).forEach(chat => {
      const row = document.createElement('div');
      row.className = 'chat-history-row' + (chat.id === activeChatId ? ' is-active' : '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-history-item';
      button.title = chat.title;
      const title = document.createElement('span');
      title.textContent = chat.title;
      button.append(title);
      button.addEventListener('click', () => openChat(chat.id));

      const optionsWrap = document.createElement('div');
      optionsWrap.className = 'chat-options-wrap';
      const optionsButton = document.createElement('button');
      optionsButton.type = 'button';
      optionsButton.className = 'chat-more-button';
      optionsButton.textContent = '⋯';
      optionsButton.setAttribute('aria-label', `Chat options for ${chat.title}`);
      optionsButton.setAttribute('aria-haspopup', 'menu');
      optionsButton.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div');
      menu.className = 'chat-options-menu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'chat-delete-button';
      deleteButton.setAttribute('role', 'menuitem');
      deleteButton.textContent = 'Delete';
      optionsButton.addEventListener('click', event => {
        event.stopPropagation();
        const shouldOpen = menu.hidden;
        document.querySelectorAll('.chat-options-menu').forEach(other => { other.hidden = true; });
        document.querySelectorAll('.chat-more-button').forEach(other => other.setAttribute('aria-expanded', 'false'));
        menu.hidden = !shouldOpen;
        optionsButton.setAttribute('aria-expanded', String(shouldOpen));
      });
      deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        menu.hidden = true;
        optionsButton.setAttribute('aria-expanded', 'false');
        deleteChat(chat);
      });
      menu.append(deleteButton);
      optionsWrap.append(optionsButton, menu);
      row.append(button, optionsWrap);
      list.append(row);
    });
    $('historyEmpty').hidden = chats.length > 0;
  }

  async function deleteChat(chat) {
    if (!window.confirm(`Delete “${chat.title}”? This chat can’t be restored.`)) return;
    try {
      await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
      chats = chats.filter(item => item.id !== chat.id);
      if (activeChatId === chat.id) startNewChat(false);
      else renderChatHistory();
    } catch (error) {
      showNotice(error.message);
    }
  }

  function renderAttachments() {
    const tray = $('attachments');
    tray.replaceChildren();
    pickedFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = file.type.startsWith('image/') ? '▧' : '↧';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = file.name;
      name.title = file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-file';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove ' + file.name);
      remove.addEventListener('click', () => { pickedFiles.splice(index, 1); renderAttachments(); });
      chip.append(icon, name, remove);
      tray.append(chip);
    });
    selectedIntegrations.forEach((item, key) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip integration-chip';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = item.type === 'Plugin' ? '✳' : '↗';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = item.name;
      name.title = item.type + ': ' + item.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-file';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove ' + item.name);
      remove.addEventListener('click', () => { selectedIntegrations.delete(key); syncIntegrationOptions(); renderAttachments(); });
      chip.append(icon, name, remove);
      tray.append(chip);
    });
    tray.hidden = pickedFiles.length === 0 && selectedIntegrations.size === 0;
  }

  function syncIntegrationOptions() {
    document.querySelectorAll('.integration-option').forEach(button => {
      const key = button.dataset.type + ':' + button.dataset.name;
      const active = selectedIntegrations.has(key);
      button.setAttribute('aria-checked', String(active));
      button.classList.toggle('is-added', active);
      button.querySelector('.option-state').textContent = active ? 'Added' : (button.dataset.type === 'Connector' ? 'Connect' : 'Add');
    });
  }

  function clearDraft() {
    input.value = '';
    pickedFiles.length = 0;
    selectedIntegrations.clear();
    syncIntegrationOptions();
    renderAttachments();
    resize();
  }

  function addMessage(role, text, usage = null, state = '', shouldScroll = true) {
    const row = document.createElement('div');
    row.className = 'message ' + role + (state ? ' ' + state : '');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.append(bubble);
    messages.append(row);
    if (shouldScroll) scrollMessagesToBottom();
    return row;
  }

  function scrollMessagesToBottom(behavior = 'smooth') {
    messages.scrollTo({ top: messages.scrollHeight, behavior });
  }

  function addUsageMeta(row, usage) {
    row.querySelector('.usage-meta')?.remove();
    const meta = document.createElement('div');
    meta.className = 'usage-meta';
    meta.textContent = `Input ${numberFormat.format(usage.inputTokens)} · Output ${numberFormat.format(usage.outputTokens)} · ${numberFormat.format(usage.totalTokens)} tokens`;
    row.append(meta);
  }

  function addTyping() {
    const row = document.createElement('div');
    row.className = 'message assistant typing';
    row.setAttribute('role', 'status');
    row.setAttribute('aria-label', 'NOIR is thinking');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    for (let index = 0; index < 3; index++) {
      const dot = document.createElement('span');
      dot.className = 'typing-dot';
      bubble.append(dot);
    }
    row.append(bubble);
    messages.append(row);
    scrollMessagesToBottom();
    return row;
  }

  async function openChat(id) {
    if (sending) return;
    try {
      const { chat } = await api(`/api/chats/${encodeURIComponent(id)}`);
      activeChatId = chat.id;
      rememberActiveChat(activeChatId);
      messages.replaceChildren();
      chat.messages.forEach(item => addMessage(item.role, item.text, item.role === 'user' ? item.usage : null, '', false));
      scrollMessagesToBottom('auto');
      $('welcome').hidden = true;
      clearDraft();
      renderChatHistory();
      if (window.matchMedia('(max-width: 700px)').matches) setSidebar(false);
    } catch (error) {
      showNotice(error.message);
    }
  }

  function startNewChat(focus = true) {
    activeChatId = null;
    rememberActiveChat(null);
    messages.replaceChildren();
    $('welcome').hidden = false;
    clearDraft();
    renderChatHistory();
    if (focus) input.focus();
    if (window.matchMedia('(max-width: 700px)').matches) setSidebar(false);
  }

  function closeAttachMenu() {
    attachMenu.hidden = true;
    attachButton.setAttribute('aria-expanded', 'false');
  }

  attachButton.addEventListener('click', event => {
    event.stopPropagation();
    attachMenu.hidden = !attachMenu.hidden;
    attachButton.setAttribute('aria-expanded', String(!attachMenu.hidden));
  });
  $('chooseFiles').addEventListener('click', () => { closeAttachMenu(); fileInput.click(); });
  $('chooseImages').addEventListener('click', () => { closeAttachMenu(); imageInput.click(); });
  [fileInput, imageInput].forEach(element => element.addEventListener('change', () => {
    for (const file of element.files) {
      if (!pickedFiles.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) pickedFiles.push(file);
    }
    renderAttachments();
    element.value = '';
  }));
  document.querySelectorAll('.integration-option').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.type + ':' + button.dataset.name;
    if (selectedIntegrations.has(key)) selectedIntegrations.delete(key);
    else selectedIntegrations.set(key, { type: button.dataset.type, name: button.dataset.name });
    syncIntegrationOptions();
    renderAttachments();
  }));

  const settingsBackdrop = $('settingsBackdrop');
  function openSettings(section = 'general') {
    closeAttachMenu();
    settingsBackdrop.hidden = false;
    document.body.classList.add('settings-open');
    document.querySelectorAll('[data-settings-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.settingsTab === section));
    document.querySelectorAll('[data-settings-panel]').forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== section; });
  }
  function closeSettings() { settingsBackdrop.hidden = true; document.body.classList.remove('settings-open'); }
  $('settingsTrigger').addEventListener('click', () => openSettings('general'));
  $('settingsClose').addEventListener('click', closeSettings);
  settingsBackdrop.addEventListener('click', event => { if (event.target === settingsBackdrop) closeSettings(); });
  document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click', () => openSettings(button.dataset.openSettings)));
  document.querySelectorAll('[data-settings-tab]').forEach(tab => tab.addEventListener('click', () => openSettings(tab.dataset.settingsTab)));
  function bindSwitch(button, initial, apply) {
    let enabled = initial;
    button.addEventListener('click', () => {
      enabled = !enabled;
      button.classList.toggle('is-on', enabled);
      button.setAttribute('aria-checked', String(enabled));
      apply(enabled);
    });
    apply(enabled);
  }
  bindSwitch($('lightAppearanceToggle'), false, enabled => document.body.classList.toggle('light-theme', enabled));
  let enterToSend = true;
  bindSwitch($('enterSendToggle'), true, enabled => { enterToSend = enabled; });
  bindSwitch($('suggestionsToggle'), true, enabled => { document.querySelector('.suggestions').hidden = !enabled; });
  bindSwitch($('compactToggle'), false, enabled => document.body.classList.toggle('compact-chat', enabled));

  let sidebarOpen = !window.matchMedia('(max-width: 700px)').matches;
  function setSidebar(open) { sidebarOpen = open; applySidebarState(); }
  function applySidebarState() {
    const mobile = window.matchMedia('(max-width: 700px)').matches;
    app.classList.toggle('sidebar-hidden', !mobile && !sidebarOpen);
    app.classList.toggle('sidebar-open-mobile', mobile && sidebarOpen);
    const label = sidebarOpen ? 'Hide sidebar' : 'Show sidebar';
    $('sidebarToggle').setAttribute('aria-label', label);
    $('sidebarToggle').title = label;
  }
  $('sidebarToggle').addEventListener('click', () => setSidebar(!sidebarOpen));
  window.addEventListener('resize', applySidebarState);
  applySidebarState();
  app.addEventListener('click', event => {
    if (event.target === app && window.matchMedia('(max-width: 700px)').matches && sidebarOpen) setSidebar(false);
  });
  document.addEventListener('click', event => { if (!event.target.closest('.attach-wrap')) closeAttachMenu(); });
  document.addEventListener('click', event => {
    if (event.target.closest('.chat-options-wrap')) return;
    document.querySelectorAll('.chat-options-menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('.chat-more-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!settingsBackdrop.hidden) closeSettings();
      else closeAttachMenu();
      $('profileMenu').hidden = true;
      $('profileTrigger').setAttribute('aria-expanded', 'false');
      document.querySelectorAll('.chat-options-menu').forEach(menu => { menu.hidden = true; });
      document.querySelectorAll('.chat-more-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }
  });

  function resize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; }
  function updateChatSummary(chat) {
    const index = chats.findIndex(item => item.id === chat.id);
    const summary = { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, totalTokens: chat.totalTokens };
    if (index >= 0) chats[index] = summary;
    else chats.push(summary);
    renderChatHistory();
  }

  async function send(text = input.value) {
    if (sending) return;
    const value = String(text || '').trim();
    if (!value) {
      if (pickedFiles.length || selectedIntegrations.size) addMessage('assistant', 'File uploads, connectors, and plugins are preview controls in this build. Type a message to send it to the AI provider.', null, 'error');
      return;
    }
    const extraSelections = pickedFiles.length || selectedIntegrations.size;
    sending = true;
    $('send').disabled = true;
    input.disabled = true;
    const userRow = addMessage('user', value);
    const typingRow = addTyping();
    $('welcome').hidden = true;
    try {
      const result = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ chatId: activeChatId, message: value, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      activeChatId = result.chat.id;
      rememberActiveChat(activeChatId);
      addUsageMeta(userRow, result.usage);
      typingRow.remove();
      addMessage('assistant', result.chat.messages.at(-1).text);
      updateChatSummary(result.chat);
      updateSession(result.session);
      if (extraSelections) showNotice('Only your typed message was sent. File uploads, connectors, and plugins are still preview controls.');
      else if (sessionInfo?.provider.ready) showNotice('', false);
      clearDraft();
    } catch (error) {
      userRow.remove();
      typingRow.remove();
      addMessage('assistant', error.message, null, 'error');
      if (error.code === 'provider_opt_in_required' || error.code === 'missing_api_key') showNotice(error.message);
      if (error.code === 'insufficient_credits') showNotice(error.message);
    } finally {
      sending = false;
      $('send').disabled = false;
      input.disabled = false;
      input.value = '';
      resize();
      input.focus({ preventScroll: true });
    }
  }

  $('profileTrigger').addEventListener('click', event => {
    event.stopPropagation();
    const open = $('profileMenu').hidden;
    $('profileMenu').hidden = !open;
    $('profileTrigger').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.profile-wrap')) return;
    $('profileMenu').hidden = true;
    $('profileTrigger').setAttribute('aria-expanded', 'false');
  });
  $('send').addEventListener('click', () => send());
  input.addEventListener('input', resize);
  input.addEventListener('keydown', event => {
    if (enterToSend && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  });
  $('newChat').addEventListener('click', () => startNewChat());
  $('homeButton').addEventListener('click', () => startNewChat());
  $('homeButtonTop').addEventListener('click', () => startNewChat());
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => send(button.dataset.prompt)));

  async function loadChatApp() {
    const timeZone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const data = await api(`/api/bootstrap?timeZone=${timeZone}`);
    chats = data.chats || [];
    updateSession(data.session);
    renderChatHistory();
    const rememberedChat = getRememberedChat();
    if (rememberedChat && chats.some(chat => chat.id === rememberedChat)) await openChat(rememberedChat);
    else startNewChat(false);
    if (authConfig?.required) {
      $('profileEmail').textContent = data.user?.email || 'Signed in';
      $('profileSignOut').hidden = false;
    } else {
      $('profileEmail').textContent = 'Local session';
      $('profileSignOut').hidden = true;
    }
    $('profileWrap').hidden = false;
    }
  }

  async function initialize() {
    try {
      authConfig = await api('/api/auth-config');
      if (authConfig.required) {
        await showAuthScreen();
        if (!authConfig.configured) return;
        if (await finishOAuthCallback()) return;
        if (authSession?.access_token) {
          try { await loadChatApp(); app.hidden = false; authGate.hidden = true; }
          catch { saveAuthSession(null); showAuthScreen(); setAuthFeedback('Your sign-in expired. Please sign in again.'); }
          return;
        }
        return;
      }
      authGate.hidden = true;
      app.hidden = false;
      await loadChatApp();
    } catch (error) {
      if (location.protocol === 'file:') {
        app.hidden = false;
        $('send').disabled = true;
        showNotice('This page was opened directly from disk and cannot reach the backend. Double-click Start NOIR.command, then use the http://127.0.0.1:3000 page it opens.');
      } else if (authConfig?.required) {
        showAuthScreen();
        setAuthFeedback(error.code === 'authentication_required' ? 'Please sign in to continue.' : 'NOIR could not reach its backend. Refresh the page or try again shortly.');
      } else {
        app.hidden = false;
        $('send').disabled = true;
        showNotice('NOIR could not reach its backend. Double-click Start NOIR.command or run npm start, then open http://127.0.0.1:3000.');
      }
    }
  }
  initialize();
})();
