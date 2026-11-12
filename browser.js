export function parseWebsiteAddress(input, appOrigin) {
  const value = input.trim();
  if (!value || /[\s\\]/.test(value)) throw new Error('Enter a valid HTTPS website address.');
  const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  let url;
  try { url = new URL(explicitScheme ? value : 'https://' + value); }
  catch { throw new Error('Enter a valid HTTPS website address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || url.origin === appOrigin) {
    throw new Error('Enter an HTTPS website address without login details. Open NOIR using the Assistant tab.');
  }
  return url.href;
}

export function resolveAddress(input, appOrigin) {
  const value = input.trim();
  if (!value || value.length > 2048) throw new Error('Enter a website or search phrase under 2,048 characters.');
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || (!/\s/.test(value) && value.split('/')[0].includes('.'))) {
    return { url: parseWebsiteAddress(value, appOrigin), search: false };
  }
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', value);
  return { url: url.href, search: true };
}

export function createBrowserWorkspace({ send, onChat, readPage, clearContext, explore, explorationStatus, cancelExploration }) {
  const $ = id => document.getElementById(id);
  const frame = $('browserFrame');
  const address = $('browserAddress');
  const entries = [null];
  let index = 0;
  let chatId = null;
  let session = 0;
  let pending = false;
  let page = null;
  let reading = 0;
  let loadTimer;
  let jobId;
  let exploring = false;
  let contextOrigin;
  function stopExploration() {
    exploring = false;
    if (jobId) cancelExploration(jobId).catch(() => {});
    jobId = null;
    $('browserCancelExplore').hidden = true;
    $('browserExplore').disabled = !entries[index] || entries[index].search;
  }
  function forgetPage(revoke = true) {
    reading++;
    stopExploration();
    contextOrigin = null;
    $('browserExploreProgress').replaceChildren();
    $('browserExploreProgress').hidden = true;
    $('browserExploreStatus').textContent = '';
    if (revoke && page) clearContext(page.id).catch(() => {});
    page = null;
    $('browserClearContext').hidden = true;
    $('browserPageSource').hidden = true;
    $('browserPageSource').removeAttribute('href');
    $('browserReadStatus').textContent = '';
  }


  function showView(browser) {
    $('assistantView').hidden = browser;
    $('browserView').hidden = !browser;
    $('assistantViewButton').setAttribute('aria-pressed', String(!browser));
    $('browserViewButton').setAttribute('aria-pressed', String(browser));
  }

  function renderAddress() {
    const entry = entries[index];
    const url = entry?.url;
    clearTimeout(loadTimer);
    const previousOrigin = contextOrigin;
    const newOrigin = url ? new URL(url).origin : null;
    if (previousOrigin && previousOrigin !== newOrigin) {
      clearConversation();
      $('browserExploreStatus').textContent = 'Previous context belonged to ' + previousOrigin + ' and was cleared.';
    } else if (!page || !page.sources) {
      if (previousOrigin && !exploring) clearConversation();
      else if (!exploring) forgetPage();
    }
    $('browserExplore').disabled = exploring || !url || entry.search;
    $('browserReadPage').disabled = !url || entry.search;
    address.value = url || '';
    $('browserBack').disabled = index === 0;
    $('browserForward').disabled = index === entries.length - 1;
    $('browserRefresh').disabled = !url;
    $('browserExternal').hidden = !url;
    $('browserEmpty').hidden = Boolean(url);
    $('browserEmbedNotice').hidden = !url;
    $('browserAddressError').hidden = true;
    $('browserEmbedStatus').textContent = 'If the page is blank or blocked, the site may prevent embedding. Open it in a new tab to continue.';
    frame.hidden = !url || entry.search;
    if (entry?.search) {
      $('browserEmbedStatus').textContent = 'Google search results open in a real browser tab. If it did not open, use the link below.';
    } else if (url) {
      $('browserEmbedStatus').textContent = 'Opening website…';
      loadTimer = setTimeout(showEmbedFallback, 6500);
    }
    if (url) {
      $('browserExternal').href = url;
      $('browserFallback').href = url;
      if (entry.search) frame.removeAttribute('src');
      else frame.src = url;
    } else {
      $('browserExternal').removeAttribute('href');
      $('browserFallback').removeAttribute('href');
      frame.removeAttribute('src');
    }
  }

  function navigate(entry) {
    if (entries[index]?.url !== entry?.url) {
      entries.splice(index + 1, entries.length, entry);
      index++;
    }
    renderAddress();
  }

  $('assistantViewButton').addEventListener('click', () => showView(false));
  $('browserViewButton').addEventListener('click', () => { showView(true); address.focus(); });
  $('browserToolbar').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const entry = resolveAddress(address.value, location.origin);
      navigate(entry);
      if (entry.search) window.open(entry.url, '_blank', 'noopener,noreferrer');
    }
    catch (error) {
      $('browserAddressError').textContent = error.message;
      $('browserAddressError').hidden = false;
    }
  });
  $('browserBack').addEventListener('click', () => { if (index > 0) { index--; renderAddress(); } });
  $('browserForward').addEventListener('click', () => { if (index < entries.length - 1) { index++; renderAddress(); } });
  $('browserRefresh').addEventListener('click', renderAddress);
  $('browserHome').addEventListener('click', () => { navigate(null); address.focus(); });
  $('browserClearAddress').addEventListener('click', () => { address.value = ''; address.focus(); $('browserAddressError').hidden = true; });
  function showEmbedFallback() {
    if (!entries[index] || entries[index].search) return;
    clearTimeout(loadTimer);
    $('browserEmbedStatus').textContent = 'If the page is blank or blocked, the site may prevent embedding. Open it in a new tab to continue.';
  }
  frame.addEventListener('load', showEmbedFallback);
  $('browserClearContext').addEventListener('click', clearConversation);
  $('browserReadPage').addEventListener('click', async () => {
    const entry = entries[index];
    if (!entry || entry.search || !confirm('Allow NOIR to read this public URL and use its text for AI replies in this sidebar?')) return;
    clearConversation();
    contextOrigin = new URL(entry.url).origin;
    const attempt = reading;
    $('browserReadPage').disabled = true;
    $('browserReadStatus').textContent = 'Reading public page…';
    try {
      const result = await readPage(entry.url);
      if (attempt !== reading) { clearContext(result.id).catch(() => {}); return; }
      page = result;
      contextOrigin = new URL(entry.url).origin;
      const source = $('browserPageSource');
      source.href = result.url;
      source.textContent = result.url;
      source.hidden = false;
      $('browserClearContext').hidden = false;
      $('browserReadStatus').textContent = 'Page read. Ask NOIR about this source.';
    } catch (error) {
      if (attempt === reading) $('browserReadStatus').textContent = error.message;
    } finally {
      if (attempt === reading) $('browserReadPage').disabled = false;
    }
  });
  $('browserCancelExplore').addEventListener('click', () => {
    forgetPage();
    $('browserExploreStatus').textContent = 'Exploration cancelled.';
  });

  $('browserExplore').addEventListener('click', async () => {
    const entry = entries[index];
    const prompt = $('browserPrompt');
    const question = prompt.value.trim() || 'Summarize the important information on this website.';
    if (!entry || entry.search || exploring || pending) return;
    if (question.length > 1200) {
      $('browserExploreStatus').textContent = 'Use a question under 1,200 characters for exploration.';
      return;
    }
    const origin = new URL(entry.url).origin;
    if (!confirm('Allow NOIR to explore up to five public pages on ' + origin + ' and send relevant excerpts to the AI to answer your question?')) return;
    clearConversation();
    contextOrigin = origin;
    exploring = true;
    const attempt = reading;
    const status = $('browserExploreStatus');
    const list = $('browserExploreProgress');
    $('browserExplore').disabled = true;
    $('browserCancelExplore').hidden = false;
    status.textContent = 'Checking website permissions…';
    try {
      const { id } = await explore(entry.url, question);
      if (attempt !== reading) { await cancelExploration(id); return; }
      jobId = id;
      while (attempt === reading) {
        const result = await explorationStatus(id);
        if (attempt !== reading) return;
        list.replaceChildren(...result.progress.map(item => {
          const row = document.createElement('li');
          row.textContent = item.title + ' — ' + item.state;
          return row;
        }));
        list.hidden = !result.progress.length;
        if (result.status === 'failed') throw new Error('NOIR could not read permitted public pages on this website.');
        if (result.status === 'complete') {
          page = result.context;
          jobId = null;
          $('browserClearContext').hidden = false;
          status.textContent = 'Read ' + page.sources.length + ' page(s). ' + page.failed + ' unavailable.';
          prompt.value = question;
          $('browserChatForm').requestSubmit();
          return;
        }
        status.textContent = 'Exploring public pages…';
        await new Promise(resolve => setTimeout(resolve, 650));
      }
    } catch (error) {
      if (attempt === reading) status.textContent = error.message;
    } finally {
      if (attempt === reading) stopExploration();
    }
  });
  frame.addEventListener('error', () => {
    $('browserEmbedStatus').textContent = 'This site could not be shown in the viewer. Open it in a new tab to continue.';
  });
  $('browserSidebarToggle').addEventListener('click', () => {
    const sidebar = $('browserSidebar');
    sidebar.hidden = !sidebar.hidden;
    $('browserSidebarToggle').setAttribute('aria-expanded', String(!sidebar.hidden));
  });

  function addMessage(label, text) {
    const row = document.createElement('article');
    const name = document.createElement('strong');
    const content = document.createElement('p');
    name.textContent = label;
    content.textContent = text;
    row.append(name, content);
    const log = $('browserMessages');
    log.append(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  function setPending(value) {
    pending = value;
    $('browserSend').disabled = value;
    $('browserChatStatus').textContent = value ? 'NOIR is thinking…' : '';
  }

  function clearConversation() {
    session++;
    forgetPage();
    $('browserReadPage').disabled = !entries[index] || entries[index].search;
    chatId = null;
    $('browserMessages').replaceChildren();
    $('browserPrompt').value = '';
    setPending(false);
  }

  $('browserClear').addEventListener('click', clearConversation);
  $('browserChatForm').addEventListener('submit', async event => {
    event.preventDefault();
    const prompt = $('browserPrompt');
    const message = prompt.value.trim();
    if (!message || pending || (exploring && !page)) return;
    const current = session;
    const usedPage = page;
    const row = addMessage('You', message);
    prompt.value = '';
    setPending(true);
    try {
      const result = await send(chatId, message, usedPage?.id);
      if (current !== session) return;
      chatId = result.chat.id;
      onChat(result);
      const reply = addMessage('NOIR', result.chat.messages.at(-1).text);
      for (const source of usedPage?.sources || []) {
        const link = document.createElement('a');
        link.href = source.url;
        link.textContent = source.title;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        reply.append(link);
      }
      setPending(false);
    } catch (error) {
      if (current !== session) return;
      row.remove();
      if (!prompt.value) prompt.value = message;
      setPending(false);
      $('browserChatStatus').textContent = error.message;
    }
  });

  return {
    showAssistant: () => showView(false),
    reset() {
      clearConversation();
      entries.splice(0, entries.length, null);
      index = 0;
      renderAddress();
      showView(false);
    },
  };
}
