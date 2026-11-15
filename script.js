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
  let integrationsInfo = null;
  let sending = false;
  let checkingModel = false;
  let cloudReply;
  let editingLastMessage = false;
  let desktopPage;
  let captureDesktopPage;
  const desktopBridge = window.noirPage;
  const modelChoice = $('modelChoice');
  const modelStatus = $('modelStatus');
  let localModels = [];
  let localHistory = [];
  let localHistoryKey;
  let localOutput;
  let downloadActive = false;
  let localStatusRequest = 0;
  function saveLocalHistory() {
    try { localStorage.setItem(localHistoryKey, JSON.stringify(localHistory)); }
    catch { showNotice('NOIR could not save this local conversation on this device.'); }
  }
  function refreshModelOptions() {
    const current = modelChoice.value;
    for (const option of [...modelChoice.querySelectorAll('[data-local]')]) option.remove();
    for (const model of localModels) {
      const option = new Option(model === 'qwen3:4b' ? 'NOIR Local · Qwen3 4B' : 'Ollama Local · ' + model, 'local:' + model);
      option.dataset.local = '';
      modelChoice.add(option, 1);
    }
    const savedModel = localHistory.find(chat => chat.id === activeChatId)?.model;
    if (savedModel && !localModels.includes(savedModel)) {
      const missing = new Option('Ollama Local · ' + savedModel + ' (offline)', 'local:' + savedModel);
      missing.dataset.local = '';
      modelChoice.add(missing, 1);
    }
    modelChoice.value = savedModel ? 'local:' + savedModel : [...modelChoice.options].some(option => option.value === current && !option.disabled) ? current : 'auto';
  }
  async function checkLocalAI() {
    const request = ++localStatusRequest;
    let result;
    try { result = await desktopBridge.localStatus(); }
    catch { result = { available: false }; }
    if (request !== localStatusRequest) return;
    localModels = result.models || [];
    refreshModelOptions();
    $('installLocalModel').hidden = !result.available || localModels.includes('qwen3:4b');
    modelStatus.textContent = result.available
      ? (localModels.length ? 'Local runtime connected.' : 'Install a local model to use Ollama.')
      : 'Ollama offline. Start it and check again.';
  }
  $('stopLocalAI').onclick = () => {
    if (cloudReply) cloudReply.abort();
    else void desktopBridge?.localStop();
  };
  if (desktopBridge?.localStatus) {
    $('checkLocalAI').hidden = false;
    $('checkLocalAI').onclick = () => void checkLocalAI();
    $('installLocalModel').onclick = async () => {
      if (downloadActive || sending) return;
      downloadActive = true;
      $('installLocalModel').disabled = true;
      $('stopLocalAI').hidden = false;
      try {
        const result = await desktopBridge.localPull();
        await checkLocalAI();
        if (result.error) modelStatus.textContent = result.error;
      } catch { modelStatus.textContent = 'Could not start the model download.'; }
      finally {
        downloadActive = false;
        $('installLocalModel').disabled = false;
        $('stopLocalAI').hidden = true;
      }
    };
    desktopBridge.onLocalProgress(progress => {
      if (progress.type === 'text' && localOutput) {
        localOutput.textContent += progress.text;
        scrollMessagesToBottom('auto');
      }
      if (progress.type === 'download' && downloadActive) {
        modelStatus.textContent = progress.status + (progress.total > 0 ? ' · ' + Math.min(100, Math.floor(progress.completed / progress.total * 100)) + '% of current layer' : '');
      }
    });
  }
  modelChoice.onchange = () => {
    if (sending || checkingModel) return;
    const draft = input.value;
    if (activeChatId) startNewChat(false);
    input.value = draft;
    resize();
    input.focus();
  };
  const pagePanel = $('desktopPagePanel');
  function attachDesktopPage(context) {
    desktopPage = context;
    $('desktopPageDetails').hidden = !context;
    $('desktopPageTitle').textContent = context?.title || '';
    $('desktopPageTitle').title = context?.title || '';
    $('desktopPageSelection').hidden = !context?.selection;
    $('desktopPageSource').textContent = context ? new URL(context.url).hostname : '';
    $('desktopPageSource').href = context?.url || '#';
    $('desktopPageStatus').textContent = context ? 'Sharing approved · ' + (context.selection ? 'Selection attached' : 'Page attached') : 'No page attached';
  }
  if (desktopBridge) {
    document.body.classList.add('desktop-assistant');
    pagePanel.hidden = false;
    desktopBridge.onChatLayout?.(mode => document.body.classList.toggle('desktop-full-chat', mode === 'full'));
    document.addEventListener('noir:home-prompt', event => {
      if (!document.body.classList.contains('desktop-chat-ready') || sending) return;
      const text = event.detail;
      if (typeof text !== 'string' || text.length > 12000) return;
      event.preventDefault();
      startNewChat(false);
      if (text) void send(text, { homepage: true });
    });
    document.querySelector('.desktop-chat-header').hidden = false;
    $('desktopChatNew').onclick = () => startNewChat();
    $('desktopChatClose').onclick = () => void desktopBridge.close?.();
    $('desktopChatHistory').onclick = () => {
      const open = document.body.classList.toggle('desktop-history-open');
      $('desktopChatHistory').setAttribute('aria-expanded', String(open));
      if (open) $('historySearch')?.focus();
    };
    desktopBridge.onAttach(attachDesktopPage);
    const explore = $('desktopPageExplore');
    const controls = $('desktopReadingControls');
    const pause = $('desktopReadingPause');
    desktopBridge.onReadingProgress?.(({ message, host, running }) => {
      $('desktopReadingStatus').textContent = host + ' · ' + message;
      controls.hidden = !running;
      if (!running) pause.textContent = 'Pause';
    });
    pause.onclick = () => {
      const paused = pause.textContent === 'Pause';
      void desktopBridge.controlReading(paused ? 'pause' : 'run');
      pause.textContent = paused ? 'Resume' : 'Pause';
    };
    $('desktopReadingStop').onclick = () => void desktopBridge.controlReading('stop');
    captureDesktopPage = async (mode = 'read') => {
      const button = $('desktopPageAsk');
      if (button.disabled) return false;
      button.disabled = explore.disabled = true;
      try {
        const result = await desktopBridge.request(mode);
        if (result.context) attachDesktopPage(result.context);
        else $('desktopPageStatus').textContent = (result.error || 'Sharing cancelled.') + (desktopPage ? ' Previous excerpt remains attached.' : '');
        return Boolean(result.context);
      } catch {
        $('desktopPageStatus').textContent = 'Could not read the active page.';
        return false;
      } finally { button.disabled = explore.disabled = false; }
    };
    $('desktopPageAsk').onclick = () => captureDesktopPage();
    explore.hidden = !desktopBridge.controlReading;
    explore.onclick = () => captureDesktopPage('explore');
    $('desktopPageSource').onclick = event => {
      event.preventDefault();
      if (desktopPage) void desktopBridge.openSource(desktopPage.url);
    };
    $('desktopPageRemove').onclick = () => attachDesktopPage(undefined);
    for (const button of pagePanel.querySelectorAll('[data-page-prompt]')) button.onclick = () => {
      if (sending || input.value.trim()) return;
      input.value = button.dataset.pagePrompt;
      resize();
      input.focus();
    };
  }

  function readAuthSession() {
    try { return JSON.parse(localStorage.getItem(authStorageKey) || 'null'); } catch { return null; }
  }
  let browserWorkspace;

  function saveAuthSession(session) {
    if (!session) cloudReply?.abort();
    if (!session) { localHistory = []; localHistoryKey = undefined; localStatusRequest++; if ($('connectorManager')) { $('connectorManager').hidden = true; $('connectorManagerOutput').textContent = ''; } document.body.classList.remove('desktop-chat-ready'); browserWorkspace?.reset(); if (desktopBridge) attachDesktopPage(undefined); }
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

  async function api(path, { onText, ...options } = {}) {
    const request = () => fetch(path, {
      credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(authSession?.access_token ? { authorization: `Bearer ${authSession.access_token}` } : {}), ...(options.headers || {}) },
    });
    let response = await request();
    if (response.status === 401 && path !== '/api/auth-config' && await refreshAuthSession()) {
      options.signal?.throwIfAborted();
      response = await request();
    }
    if (response.ok && onText && response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line) continue;
            const frame = JSON.parse(line);
            if (frame.error) throw Object.assign(new Error(frame.error), frame);
            if (frame.result) return frame.result;
            if (typeof frame.text === 'string') onText(frame.text);
          }
        }
        throw new Error('The response ended early. Please try again.');
      } finally { await reader.cancel().catch(() => {}); }
    }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status, code: data.code, details: data.details });
    return data;
  }

  function showNotice(text, visible = true) {
    const notice = $('appNotice');
    notice.textContent = text;
    notice.hidden = !visible;
  }

  function updateSession(data) {
    sessionInfo = data;
    const freeCloud = modelChoice.querySelector('[value="free-cloud"]');
    freeCloud.disabled = !data.freeCloudAvailable;
    freeCloud.textContent = 'Free cloud · OpenRouter' + (data.freeCloudAvailable ? ' (quota limited)' : ' (not configured)');
    const usage = data.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    $('profileLifetimeTokens').textContent = numberFormat.format(usage.totalTokens || 0);
    $('profileDailyTokens').textContent = numberFormat.format(data.dailyTokens || 0);
    $('inputTokenTotal').textContent = numberFormat.format(usage.inputTokens || 0);
    $('outputTokenTotal').textContent = numberFormat.format(usage.outputTokens || 0);
    $('profileTrigger').setAttribute('aria-label', `Profile and token usage: ${numberFormat.format(usage.totalTokens || 0)} tokens`);
    $('creditsPanel').hidden = !data.creditsEnabled;
    if (data.creditsEnabled) $('creditBalance').textContent = data.creditsUnlimited ? 'Unlimited' : numberFormat.format(data.credits || 0);

    const subscription = data.subscription || { isPlus: false, status: 'free', manageAvailable: false };
    const isPlus = Boolean(subscription.isPlus);
    $('profilePlanStatus').textContent = isPlus ? 'NOIR Plus' : 'NOIR Free';
    $('profilePlanAction').hidden = !isPlus && data.plusCheckoutEnabled === false;
    $('profilePlanAction').textContent = isPlus ? 'View Plus benefits' : 'Explore Plus';
    $('settingsPlanName').textContent = isPlus ? 'NOIR Plus' : 'NOIR Free';
    $('planStatusDescription').textContent = isPlus ? 'Your Plus benefits are active.' : 'You’re using NOIR Free.';
    $('settingsPlanDetail').textContent = isPlus
      ? subscription.cancelAtPeriodEnd ? `Active until ${formatBillingDate(subscription.currentPeriodEnd)}.` : `Renews ${formatBillingDate(subscription.renewalDate)}.`
      : data.dailyTokenLimit ? `${numberFormat.format(data.dailyTokens || 0)} of ${numberFormat.format(data.dailyTokenLimit)} daily tokens used.` : 'Free daily quota is currently not configured.';
    const manageAvailable = Boolean(subscription.manageAvailable);
    $('manageSubscription').hidden = !manageAvailable;
    $('settingsManageButton').hidden = !manageAvailable;
    $('plusManage').hidden = !manageAvailable;
    $('settingsUpgradeButton').hidden = isPlus || data.plusCheckoutEnabled === false;
    $('plusCheckout').hidden = isPlus || data.plusCheckoutEnabled === false;
    $('limitUpgrade').hidden = data.plusCheckoutEnabled === false;
    $('profileDailyUsage').hidden = isPlus || !data.dailyTokenLimit;
    $('profileDailyUsage').textContent = !isPlus && data.dailyTokenLimit ? `Today: ${numberFormat.format(data.dailyTokens || 0)} / ${numberFormat.format(data.dailyTokenLimit)} tokens` : '';

    if (data.provider.ready || (data.provider.freeLaunch && desktopBridge?.localStatus)) showNotice('', false);
    else if (data.provider.freeLaunch) showNotice('Free cloud chat is not configured yet. NOIR Local runs in the desktop app.');
    else if (!data.provider.keyConfigured) showNotice('AI replies are not configured yet. The site owner needs to finish the server setup.');
    else if (!data.provider.requestsEnabled) showNotice('AI replies are paused until the site owner enables the service.');
    else showNotice('The AI service needs attention. Please try again later or contact the site owner.');
  }

  function updateIntegrationAvailability(data) {
    integrationsInfo = data || null;
    document.querySelectorAll('.integration-option').forEach(button => {
      const state = button.querySelector('.option-state');
      const availability = button.dataset.type === 'Connector' ? data?.connectors?.[button.dataset.name] : data?.plugins?.[button.dataset.name];
      const ready = Boolean(availability?.ready);
      const desktopConnector = desktopBridge && button.dataset.type === 'Connector';
      button.disabled = !ready;
      if (ready && desktopConnector) button.title = 'Manage this connection on the NOIR website.';
      button.setAttribute('aria-disabled', String(!ready));
      if (!ready) {
        state.textContent = button.dataset.type === 'Connector' ? 'Setup required' : 'Unavailable';
        const help = button.querySelector('.setting-option-copy small');
        if (help && availability?.reason === 'isolated_sandbox_required') help.textContent = 'Disabled until isolated execution is available';
        else if (help && availability?.reason === 'missing_credentials') help.textContent = 'Search provider credentials are required';
        else if (help && availability?.reason === 'disabled_by_owner') help.textContent = 'Disabled by the site owner';
        else if (help && availability?.reason === 'oauth_not_implemented') help.textContent = 'OAuth setup is not available yet';
      } else if (!selectedIntegrations.has(button.dataset.type + ':' + button.dataset.name)) {
        state.textContent = button.dataset.type === 'Connector' ? (availability.connected ? 'Connected' : 'Connect') : 'Add';
      }
    });
  }

  function formatBillingDate(value) {
    if (!value) return 'your next billing date';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'your next billing date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }

  function openPlus() {
    $('profileMenu').hidden = true;
    $('profileTrigger').setAttribute('aria-expanded', 'false');
    $('limitBackdrop').hidden = true;
    document.body.classList.remove('limit-open');
    $('plusFeedback').textContent = '';
    $('plusBackdrop').hidden = false;
    document.body.classList.add('plus-open');
    $('plusClose').focus({ preventScroll: true });
  }

  function closePlus() {
    $('plusBackdrop').hidden = true;
    document.body.classList.remove('plus-open');
  }

  function showDailyLimit(details = {}) {
    const resetAt = details.resetAt ? new Date(details.resetAt) : null;
    $('limitResetTime').textContent = resetAt && !Number.isNaN(resetAt.valueOf())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' }).format(resetAt)
      : 'midnight UTC';
    $('limitBackdrop').hidden = false;
    document.body.classList.add('limit-open');
    $('limitWait').focus({ preventScroll: true });
  }

  async function startCheckout() {
    const button = $('plusCheckout');
    button.disabled = true; button.textContent = 'Opening secure checkout…'; $('plusFeedback').textContent = '';
    try {
      const result = await api('/api/plus/checkout', { method: 'POST' });
      if (!result.url?.startsWith('https://checkout.stripe.com/')) throw new Error('NOIR could not open secure checkout.');
      location.assign(result.url);
    } catch (error) {
      $('plusFeedback').textContent = error.message;
      button.textContent = 'Get NOIR Plus · $15 AUD/month'; button.disabled = false;
    }
  }

  async function openBillingPortal() {
    const buttons = [$('manageSubscription'), $('settingsManageButton'), $('plusManage')];
    buttons.forEach(button => { button.disabled = true; });
    $('plusFeedback').textContent = '';
    try {
      const result = await api('/api/plus/manage', { method: 'POST' });
      if (!result.url?.startsWith('https://billing.stripe.com/')) throw new Error('NOIR could not open subscription management.');
      location.assign(result.url);
    } catch (error) {
      $('plusFeedback').textContent = error.message;
      showNotice(error.message);
    } finally { buttons.forEach(button => { button.disabled = false; }); }
  }

  async function confirmPlusFromWebhook() {
    const params = new URLSearchParams(location.search);
    const result = params.get('plus');
    if (!result) return;
    history.replaceState({}, '', location.pathname);
    if (result === 'canceled') { showNotice('Checkout was canceled. You can return to NOIR Free at any time.', true); return; }
    showNotice('Payment complete. Confirming your subscription securely…', true);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const data = await api('/api/subscription');
        if (data.subscription?.isPlus) {
          updateSession({ ...sessionInfo, subscription: data.subscription });
          showNotice('NOIR Plus is active. Welcome aboard.', true);
          return;
        }
      } catch (error) { showNotice(error.message, true); return; }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    showNotice('Payment completed. Stripe is still confirming the subscription; Plus will turn on automatically when the verified webhook arrives.', true);
  }

  function rememberActiveChat(id) {
    try { id ? localStorage.setItem('noirActiveChatId', id) : localStorage.removeItem('noirActiveChatId'); } catch {}
  }
  function getRememberedChat() {
    try { return localStorage.getItem('noirActiveChatId'); } catch { return null; }
  }

  function renderChatHistory() {
    if (desktopBridge) $('desktopChatTitle').textContent = chats.find(chat => chat.id === activeChatId)?.title || 'New conversation';
    const list = $('chatHistory');
    list.replaceChildren();
    const query = ($('historySearch')?.value || '').trim().toLocaleLowerCase();
    const visibleChats = [...chats].filter(chat => chat.title.toLocaleLowerCase().includes(query)).sort((a, b) => b.updatedAt - a.updatedAt);
    visibleChats.forEach(chat => {
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
    $('historyEmpty').hidden = visibleChats.length > 0;
    $('historyEmpty').textContent = chats.length && query ? 'No matching chats.' : 'Your saved chats will appear here.';
  }

  async function deleteChat(chat) {
    if (!window.confirm(`Delete “${chat.title}”? This chat can’t be restored.`)) return;
    try {
      if (localHistory.some(row => row.id === chat.id)) {
        localHistory = localHistory.filter(row => row.id !== chat.id);
        saveLocalHistory();
      } else await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
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
      if (button.dataset.type === 'Connector') return;
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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function highlightCode(code, language = '') {
    const escaped = escapeHtml(code);
    const known = /^(js|javascript|ts|typescript|json|html|css|python|py|bash|sh|sql|java|go|rust|c|cpp|yaml|yml|)$/i.test(language);
    if (!known) return escaped;
    return escaped
      .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, '<span class="syntax-string">$1</span>')
      .replace(/(^|\s)(\/\/.*|#.*)$/gm, '$1<span class="syntax-comment">$2</span>')
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|new|async|await|import|from|export|default|def|print|true|false|null|None|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE)\b/g, '<span class="syntax-keyword">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="syntax-number">$1</span>');
  }

  function renderMarkdown(text) {
    const blocks = [];
    let source = String(text).replace(/\r\n?/g, '\n').replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_match, language, code) => {
      const index = blocks.push(`<pre class="code-block"><div class="code-toolbar"><span>${escapeHtml(language || 'Code')}</span><button type="button" class="copy-code" aria-label="Copy code">Copy</button></div><code>${highlightCode(code.replace(/\n$/, ''), language)}</code></pre>`) - 1;
      return `\u0000${index}\u0000`;
    });
    source = escapeHtml(source)
      .replace(/^###\s+(.+)$/gm, '<h4>$1</h4>').replace(/^##\s+(.+)$/gm, '<h3>$1</h3>').replace(/^#\s+(.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/(?:^|\n)([-*])\s+(.+)(?=\n|$)/g, '\n<li>$2</li>')
      .replace(/((?:<li>[\s\S]*?<\/li>\n?)+)/g, '<ul>$1</ul>')
      .replace(/\n/g, '<br>')
      .replace(/\u0000(\d+)\u0000/g, (_match, index) => `</p>${blocks[Number(index)]}<p>`);
    return `<p>${source}</p>`.replace(/<p><\/p>/g, '').replace(/<p>(<h[234]>)/g, '$1').replace(/(<\/h[234]>)<br>/g, '$1').replace(/<p>(<ul>|<blockquote>|<pre)/g, '$1').replace(/(<\/ul>|<\/blockquote>|<\/pre>)<\/p>/g, '$1');
  }

  function addMessage(role, text, usage = null, state = '', shouldScroll = true, attachmentNames = []) {
    const row = document.createElement('div');
    row.className = 'message ' + role + (state ? ' ' + state : '');
    if (role === 'assistant') {
      const mark = document.createElement('img'); mark.className = 'assistant-mark'; mark.src = 'logo.svg'; mark.alt = '';
      row.append(mark);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'assistant' && !state) {
      const source = desktopBridge && /\n\nSources\n\[Current page\]\((https:\/\/[^\s()]+)\)$/.exec(text);
      bubble.innerHTML = renderMarkdown(source ? text.slice(0, source.index) : text);
      if (source) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'desktop-source-link';
        link.textContent = 'Open current page source';
        link.onclick = () => void desktopBridge.openSource(source[1]);
        bubble.append(link);
      }
    }
    else bubble.textContent = text;
    if (role === 'user' && attachmentNames.length) {
      const label = document.createElement('div');
      label.className = 'message-attachments';
      label.textContent = `📎 ${attachmentNames.join(' · ')}`;
      bubble.append(document.createElement('br'), label);
    }
    row.append(bubble);
    messages.append(row);
    if (role === 'assistant' && !state && !row.classList.contains('typing')) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy'; copy.setAttribute('aria-label', 'Copy response');
      copy.addEventListener('click', async () => { await navigator.clipboard?.writeText(text); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); });
      const regenerate = document.createElement('button'); regenerate.type = 'button'; regenerate.textContent = 'Regenerate'; regenerate.setAttribute('aria-label', 'Regenerate response');
      regenerate.addEventListener('click', () => {
        const lastUser = [...messages.querySelectorAll('.message.user .bubble')].at(-1)?.textContent;
        if (lastUser && row === [...messages.querySelectorAll('.message.assistant:not(.typing):not(.error)')].at(-1)) send(lastUser, { regenerate: true });
      });
      actions.append(copy, regenerate);
      row.append(actions);
      row.querySelectorAll('.copy-code').forEach(button => button.addEventListener('click', async () => {
        const code = button.closest('.code-block')?.querySelector('code')?.textContent || '';
        await navigator.clipboard?.writeText(code); button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      }));
    }
    if (role === 'user' && !state) {
      const actions = document.createElement('div'); actions.className = 'message-actions user-message-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', 'Edit message');
      edit.addEventListener('click', () => {
        if (row !== [...messages.querySelectorAll('.message.user')].at(-1)) return;
        input.value = bubble.textContent; editingLastMessage = true; resize(); input.focus({ preventScroll: true });
      });
      actions.append(edit); row.append(actions);
    }
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
    const mark = document.createElement('img'); mark.className = 'assistant-mark'; mark.src = 'logo.svg'; mark.alt = '';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    for (let index = 0; index < 3; index++) {
      const dot = document.createElement('span');
      dot.className = 'typing-dot';
      bubble.append(dot);
    }
    row.append(mark, bubble);
    messages.append(row);
    scrollMessagesToBottom();
    return row;
  }

  async function openChat(id) {
    browserWorkspace?.showAssistant();
    if (sending || id === activeChatId) return;
    try {
      const local = localHistory.find(chat => chat.id === id);
      const { chat } = local ? { chat: local } : await api(`/api/chats/${encodeURIComponent(id)}`);
      modelChoice.value = local ? 'local:' + chat.model : 'auto';
      if (desktopPage) attachDesktopPage(undefined);
      editingLastMessage = false;
      activeChatId = chat.id;
      refreshModelOptions();
      if (desktopBridge) {
        document.body.classList.remove('desktop-history-open');
        $('desktopChatHistory').setAttribute('aria-expanded', 'false');
      }
      rememberActiveChat(activeChatId);
      messages.replaceChildren();
      chat.messages.forEach(item => addMessage(item.role, item.text, item.role === 'user' ? item.usage : null, '', false, item.attachments?.map(file => file.name) || []));
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
    browserWorkspace?.showAssistant();
    if (sending) return;
    if (desktopPage) attachDesktopPage(undefined);
    editingLastMessage = false;
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
      const extension = file.name.split('.').pop().toLowerCase();
      const allowed = new Set(['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json', 'image/png', 'image/jpeg', 'image/webp']);
      const accepted = allowed.has(file.type) || /\.(pdf|txt|csv|md|markdown|json|png|jpe?g|webp)$/i.test(file.name);
      if (!accepted) { showNotice(`“${file.name}” is not a supported file type.`); continue; }
      if (file.size < 1 || file.size > (integrationsInfo?.fileLimits?.maxFileBytes || 3 * 1024 * 1024)) { showNotice(`Each file must be smaller than 3 MB: “${file.name}”.`); continue; }
      if (pickedFiles.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue;
      const existingBytes = pickedFiles.reduce((sum, picked) => sum + picked.size, 0);
      if (pickedFiles.length >= (integrationsInfo?.fileLimits?.maxFiles || 4) || existingBytes + file.size > (integrationsInfo?.fileLimits?.maxTotalBytes || 5 * 1024 * 1024)) { showNotice('Attach up to 4 files totaling 5 MB or less per message.'); continue; }
      if (!file.type && !extension) { showNotice(`“${file.name}” is missing a supported file type.`); continue; }
      pickedFiles.push(file);
    }
    renderAttachments();
    element.value = '';
  }));
  function renderConnectorManager(name) {
    const panel = $('connectorManager');
    const availability = integrationsInfo?.connectors?.[name];
    if (!availability?.ready) return;
    panel.hidden = false;
    $('connectorManagerName').textContent = name;
    $('connectorManagerPermissions').textContent = availability.permissions?.join(' · ') || '';
    $('connectorManagerStatus').textContent = desktopBridge ? 'Open NOIR in your default browser to authorize and manage this connection.' : '';
    const preview = $('connectorManagerOutput');
    preview.textContent = '';
    for (const [id, action] of [['connectorConnect', 'start'], ['connectorRead', 'read'], ['connectorDisconnect', 'disconnect']]) {
      const button = $(id);
      button.hidden = Boolean(desktopBridge) || (action !== 'start' && !availability.connected);
      if (action === 'start') button.textContent = availability.connected ? 'Reconnect' : 'Connect';
      button.onclick = async () => {
        const status = $('connectorManagerStatus');
        const buttons = [...panel.querySelectorAll('button')];
        buttons.forEach(item => { item.disabled = true; });
        status.textContent = 'Working…';
        try {
          const result = await api('/api/connectors/' + action, { method: 'POST', body: JSON.stringify({ name }) });
          if (action === 'start') { location.assign(result.authorizeUrl); return; }
          if (action === 'disconnect') {
            const { integrations } = await api('/api/integrations');
            updateIntegrationAvailability(integrations);
            renderConnectorManager(name);
            status.textContent = 'Disconnected from NOIR. You can also remove access in your Google Account.';
            return;
          }
          $('connectorManagerOutput').textContent = result.rows.map(row => row.filter(Boolean).join(' · ')).join('\n');
          status.textContent = result.rows.length ? 'Showing recent items from this connection.' : 'No recent items were returned.';
        } catch (error) {
          status.textContent = error.message;
        } finally { buttons.forEach(item => { item.disabled = false; }); }
      };
    }
    $('connectorWebLink').hidden = !desktopBridge?.openConnectors;
    $('connectorWebLink').onclick = () => void desktopBridge?.openConnectors?.();
  }

  document.querySelectorAll('.integration-option').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    if (button.dataset.type === 'Connector') { renderConnectorManager(button.dataset.name); return; }
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
  $('profilePlanAction').addEventListener('click', openPlus);
  $('settingsUpgradeButton').addEventListener('click', openPlus);
  $('plusClose').addEventListener('click', closePlus);
  $('plusDismiss').addEventListener('click', closePlus);
  $('plusBackdrop').addEventListener('click', event => { if (event.target === $('plusBackdrop')) closePlus(); });
  $('plusCheckout').addEventListener('click', startCheckout);
  $('limitUpgrade').addEventListener('click', openPlus);
  $('limitWait').addEventListener('click', () => { $('limitBackdrop').hidden = true; document.body.classList.remove('limit-open'); input.focus({ preventScroll: true }); });
  $('settingsManageButton').addEventListener('click', openBillingPortal);
  $('manageSubscription').addEventListener('click', openBillingPortal);
  $('plusManage').addEventListener('click', openBillingPortal);
  function bindSwitch(button, initial, apply) {
    let enabled = initial;
    const sync = () => {
      button.classList.toggle('is-on', enabled);
      button.setAttribute('aria-checked', String(enabled));
    };
    button.addEventListener('click', () => {
      enabled = !enabled;
      sync();
      apply(enabled);
    });
    sync();
    apply(enabled);
  }
  const preferenceKey = 'noirPreferences';
  let savedPreferences = {};
  try { savedPreferences = JSON.parse(localStorage.getItem(preferenceKey) || '{}'); } catch {}
  function savePreference(name, enabled) { savedPreferences[name] = enabled; try { localStorage.setItem(preferenceKey, JSON.stringify(savedPreferences)); } catch {} }
  bindSwitch($('lightAppearanceToggle'), Boolean(savedPreferences.light), enabled => { document.body.classList.toggle('light-theme', enabled); savePreference('light', enabled); });
  let enterToSend = true;
  bindSwitch($('enterSendToggle'), savedPreferences.enterSend !== false, enabled => { enterToSend = enabled; savePreference('enterSend', enabled); });
  bindSwitch($('suggestionsToggle'), savedPreferences.suggestions !== false, enabled => { document.querySelector('.suggestions').hidden = !enabled; savePreference('suggestions', enabled); });
  bindSwitch($('compactToggle'), Boolean(savedPreferences.compact), enabled => { document.body.classList.toggle('compact-chat', enabled); savePreference('compact', enabled); });

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
  $('historySearch').addEventListener('input', renderChatHistory);
  const profileMenu = $('profileMenu');
  $('profileTrigger').addEventListener('click', event => {
    event.stopPropagation(); profileMenu.hidden = !profileMenu.hidden;
    $('profileTrigger').setAttribute('aria-expanded', String(!profileMenu.hidden));
  });
  window.addEventListener('resize', applySidebarState);
  applySidebarState();
  app.addEventListener('click', event => {
    if (event.target === app && window.matchMedia('(max-width: 700px)').matches && sidebarOpen) setSidebar(false);
  });
  document.addEventListener('click', event => { if (!event.target.closest('.attach-wrap')) closeAttachMenu(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('.profile-wrap')) { profileMenu.hidden = true; $('profileTrigger').setAttribute('aria-expanded', 'false'); }
    if (event.target.closest('.chat-options-wrap')) return;
    document.querySelectorAll('.chat-options-menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('.chat-more-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!settingsBackdrop.hidden) closeSettings();
      else closeAttachMenu();
      if (!$('plusBackdrop').hidden) closePlus();
      $('limitBackdrop').hidden = true; document.body.classList.remove('limit-open');
      profileMenu.hidden = true; $('profileTrigger').setAttribute('aria-expanded', 'false');
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

  async function send(text = input.value, options = {}) {
    if (sending || checkingModel) return;
    options = { ...options, edit: options.edit ?? (!options.regenerate && editingLastMessage) };
    let value = String(text || '').trim();
    if (!value && pickedFiles.length) value = 'Analyze the attached file(s) and summarize the key information.';
    if (!value) {
      return;
    }
    const explorePage = desktopBridge?.controlReading && !options.homepage && !options.regenerate &&
      /\bscroll (?:down|further)|\b(?:explore|read) (?:this|the) (?:whole |entire )?(?:web)?page/i.test(value);
    const readPage = desktopBridge && !options.homepage && !options.regenerate &&
      /\b(?:this|current|open) (?:web)?page\b/i.test(value);
    if (explorePage || readPage) {
      if (!await captureDesktopPage(explorePage ? 'explore' : 'read')) return;
      if (sending || checkingModel) return;
    }
    if (downloadActive) { showNotice('Stop or finish the local model download first.'); return; }
    if (desktopBridge?.localStatus && modelChoice.value === 'auto' && !activeChatId) {
      checkingModel = true;
      try { await checkLocalAI(); }
      finally { checkingModel = false; }
      if (sending || downloadActive || app.hidden) return;
    }
    const previousLocal = localHistory.find(chat => chat.id === activeChatId);
    const chosen = modelChoice.value;
    const localModel = previousLocal?.model || (chosen.startsWith('local:') ? chosen.slice(6) :
      chosen === 'auto' && !activeChatId && !pickedFiles.length && !selectedIntegrations.size
        ? localModels.find(model => model === 'qwen3:4b') || localModels[0] : '');
    if (!localModel && desktopBridge?.localStatus && chosen === 'auto' && !activeChatId &&
        sessionInfo?.provider.freeLaunch && sessionInfo?.freeCloudAvailable &&
        !window.confirm('Send this new conversation to the free cloud service?')) return;
    if (localModel && (pickedFiles.length || selectedIntegrations.size)) {
      showNotice('This local chat supports text and approved page excerpts. Remove the attachments or choose a cloud model.');
      return;
    }
    sending = true;
    modelChoice.disabled = true;
    $('send').disabled = true;
    input.disabled = true;
    let failed = false;
    const attachmentNames = pickedFiles.map(file => file.name);
    const userRow = options.regenerate || options.edit ? null : addMessage('user', value, null, '', true, attachmentNames);
    const typingRow = addTyping();
    $('welcome').hidden = true;
    try {
      if (localModel) {
        const previous = previousLocal?.messages || [];
        const editFrom = options.edit || options.regenerate ? previous.slice(0, -2) : previous;
        const turns = [...editFrom, { role: 'user', text: value }];
        const excerpt = desktopPage ? '\n\nApproved, untrusted webpage excerpt from ' + desktopPage.url + ':\n' + desktopPage.text.slice(0, 4500) : '';
        let remaining = 24000;
        const context = [];
        for (const item of turns.slice(-24).reverse()) {
          const content = (item.text + (context.length === 0 ? excerpt : '')).slice(0, Math.min(12000, remaining));
          if (!content) break;
          context.unshift({ role: item.role, content });
          remaining -= content.length;
        }
        localOutput = typingRow.querySelector('.bubble');
        $('stopLocalAI').hidden = false;
        const historyKey = localHistoryKey;
        const result = await desktopBridge.localChat({ model: localModel, messages: context });
        if (!historyKey || historyKey !== localHistoryKey) {
          typingRow.remove();
          userRow?.remove();
          return;
        }
        if (!result.text || result.error || result.cancelled) throw Object.assign(new Error(result.error || 'Local generation stopped.'), { code: result.cancelled ? 'local_cancelled' : 'local_error' });
        const source = desktopPage?.url;
        const reply = source ? result.text + '\n\nSources\n[Current page](' + source.replaceAll('(', '%28').replaceAll(')', '%29') + ')' : result.text;
        const chat = { id: previousLocal?.id || 'local-' + crypto.randomUUID(), model: localModel,
          title: previousLocal?.title || value.replace(/\s+/g, ' ').slice(0, 42), updatedAt: Date.now(),
          messages: [...turns, { role: 'assistant', text: reply, usage: result.usage }].slice(-100) };
        localHistory = [chat, ...localHistory.filter(item => item.id !== chat.id)].slice(0, 30);
        saveLocalHistory();
        activeChatId = chat.id;
        rememberActiveChat(chat.id);
        messages.replaceChildren();
        chat.messages.forEach(item => addMessage(item.role, item.text, null, '', false));
        scrollMessagesToBottom();
        updateChatSummary(chat);
        clearDraft();
        editingLastMessage = false;
        showNotice('', false);
        return;
      }
      const encodedAttachments = await Promise.all(pickedFiles.map(async file => ({
        name: file.name,
        mimeType: file.type || ({ pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[file.name.split('.').pop().toLowerCase()] || ''),
        data: (await fileToDataUrl(file)).split(',')[1] || '',
      })));
      const pluginNames = [...selectedIntegrations.values()].filter(item => item.type === 'Plugin').map(item => item.name);
      const page = desktopPage;
      const routing = sessionInfo?.smartRouting;
      const routingPageConsent = Boolean(page && routing?.enabled &&
        window.confirm('Allow this reply to share the excerpt and relevant chat history with: ' + routing.providers.join(', ') + '?'));
      cloudReply = new AbortController();
      $('stopLocalAI').hidden = false;
      const result = await api(page ? '/api/desktop/chat' : '/api/chat', {
        method: 'POST',
        signal: cloudReply.signal,
        body: JSON.stringify({ stream: true, ...(page ? { desktopPage: { ...page, consent: true }, routingPageConsent, routingConsentVersion: routing?.consentVersion } : {}), chatId: activeChatId, modelChoice: chosen === 'free-cloud' ? 'free-cloud' : 'auto', message: value, regenerate: Boolean(options.regenerate), edit: Boolean(options.edit), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, attachments: encodedAttachments, plugins: pluginNames }),
        onText(part) {
          const bubble = typingRow.querySelector('.bubble');
          if (typingRow.classList.contains('typing')) {
            typingRow.classList.remove('typing');
            bubble.textContent = '';
          }
          bubble.textContent += part;
          scrollMessagesToBottom('auto');
        },
      });
      activeChatId = result.chat.id;
      rememberActiveChat(activeChatId);
      typingRow.remove();
      if (options.regenerate || options.edit) {
        messages.querySelector('.message.assistant:not(.typing):not(.error):last-of-type')?.remove();
        if (options.edit) [...messages.querySelectorAll('.message.user')].at(-1)?.remove();
      }
      addMessage('assistant', result.chat.messages.at(-1).text);
      updateChatSummary(result.chat);
      updateSession(result.session);
      if (sessionInfo?.provider.ready) showNotice('', false);
      clearDraft();
      editingLastMessage = false;
    } catch (error) {
      failed = true;
      userRow?.remove();
      typingRow.remove();
      if (error.code === 'daily_token_limit') showDailyLimit(error.details);
      else if (error.code !== 'local_cancelled' && error.name !== 'AbortError') addMessage('assistant', error.message, null, 'error');
      if (error.code === 'provider_opt_in_required' || error.code === 'missing_api_key') showNotice(error.message);
      if (error.code === 'insufficient_credits') showNotice(error.message);
    } finally {
      sending = false;
      cloudReply = undefined;
      localOutput = undefined;
      $('stopLocalAI').hidden = true;
      modelChoice.disabled = false;
      $('send').disabled = false;
      input.disabled = false;
      if (!options.regenerate) input.value = failed ? value : '';
      resize();
      if (!options.regenerate && $('limitBackdrop').hidden) input.focus({ preventScroll: true });
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Could not read “${file.name}”.`));
      reader.readAsDataURL(file);
    });
  }

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
    localHistoryKey = desktopBridge?.localStatus ? 'noirLocalHistory:' + (data.user?.email || 'local-session').toLowerCase() : undefined;
    if (localHistoryKey) {
      try { localHistory = JSON.parse(localStorage.getItem(localHistoryKey) || '[]'); }
      catch { localHistory = []; }
    }
    chats = [...(data.chats || []), ...localHistory];
    if (desktopBridge?.localStatus) await checkLocalAI();
    updateSession(data.session);
    updateIntegrationAvailability(data.integrations);
    renderChatHistory();
    const rememberedChat = getRememberedChat();
    if (rememberedChat && chats.some(chat => chat.id === rememberedChat)) await openChat(rememberedChat);
    else startNewChat(false);
    if (authConfig?.required) {
      $('profileEmail').textContent = data.user?.email || 'Signed in';
      $('profileWrap').hidden = false;
      $('profileSignOut').hidden = false;
    } else {
      $('profileEmail').textContent = 'Local session';
      $('profileWrap').hidden = false;
      $('profileSignOut').hidden = true;
    }
    await confirmPlusFromWebhook();
    const params = new URL(location.href).searchParams;
    if (params.get('settings') === 'connectors') openSettings('connectors');
    const connection = params.get('connector');
    if (connection === 'connected' || connection === 'incomplete') {
      history.replaceState(null, '', location.pathname + location.hash);
      openSettings('connectors');
      $('connectorCallbackStatus').textContent = connection === 'connected' ? 'Google connection saved.' : 'Authorization was cancelled or incomplete. You can try again.';
    }
    if (desktopBridge) document.body.classList.add('desktop-chat-ready');
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
  import('./browser.js').then(({ createBrowserWorkspace }) => {
    browserWorkspace = createBrowserWorkspace({
      explore: (url, question, research) => api('/api/browser/explore', { method: 'POST', body: JSON.stringify({ url, question, research, consent: true }) }),
      explorationStatus: id => api('/api/browser/explore?id=' + encodeURIComponent(id)),
      cancelExploration: id => api('/api/browser/explore?id=' + encodeURIComponent(id), { method: 'DELETE' }),
      readPage: url => api('/api/browser/read', { method: 'POST', body: JSON.stringify({ url, consent: true }) }),
      clearContext: id => api('/api/browser/context', { method: 'DELETE', body: JSON.stringify({ id }) }),
      async send(chatId, message, pageContextId, onText, signal) {
        const routing = sessionInfo?.smartRouting;
        const routingPageConsent = Boolean(pageContextId && routing?.enabled &&
          window.confirm('Allow NOIR to share the selected public page excerpts and relevant chat history for this reply with: ' + routing.providers.join(', ') + '? Choose Cancel to use your standard provider.'));
        const result = await api('/api/chat', {
          method: 'POST',
          onText, signal,
          body: JSON.stringify({ stream: true, chatId, message, pageContextId, routingPageConsent, routingConsentVersion: routing?.consentVersion, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
        return result;
      },
      onChat({ chat, session }) {
        updateChatSummary(chat);
        updateSession(session);
      },
    });
  }).catch(() => { $('browserViewButton').disabled = true; });
  initialize();
})();
