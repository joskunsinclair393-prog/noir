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

export function createBrowserWorkspace({ send, onChat }) {
  const $ = id => document.getElementById(id);
  const frame = $('browserFrame');
  const address = $('browserAddress');
  const entries = [null];
  let index = 0;
  let chatId = null;
  let session = 0;
  let pending = false;

  function showView(browser) {
    $('assistantView').hidden = browser;
    $('browserView').hidden = !browser;
    $('assistantViewButton').setAttribute('aria-pressed', String(!browser));
    $('browserViewButton').setAttribute('aria-pressed', String(browser));
  }

  function renderAddress() {
    const url = entries[index];
    address.value = url || '';
    $('browserBack').disabled = index === 0;
    $('browserForward').disabled = index === entries.length - 1;
    $('browserRefresh').disabled = !url;
    $('browserExternal').hidden = !url;
    $('browserEmpty').hidden = Boolean(url);
    $('browserEmbedNotice').hidden = !url;
    $('browserAddressError').hidden = true;
    $('browserEmbedStatus').textContent = 'If the page is blank or blocked, the site may prevent embedding. Open it in a new tab to continue.';
    frame.hidden = !url;
    if (url) {
      $('browserExternal').href = url;
      $('browserFallback').href = url;
      frame.src = url;
    } else {
      $('browserExternal').removeAttribute('href');
      $('browserFallback').removeAttribute('href');
      frame.removeAttribute('src');
    }
  }

  function navigate(url) {
    if (entries[index] !== url) {
      entries.splice(index + 1, entries.length, url);
      index++;
    }
    renderAddress();
  }

  $('assistantViewButton').addEventListener('click', () => showView(false));
  $('browserViewButton').addEventListener('click', () => { showView(true); address.focus(); });
  $('browserToolbar').addEventListener('submit', event => {
    event.preventDefault();
    try { navigate(parseWebsiteAddress(address.value, location.origin)); }
    catch (error) {
      $('browserAddressError').textContent = error.message;
      $('browserAddressError').hidden = false;
    }
  });
  $('browserBack').addEventListener('click', () => { if (index > 0) { index--; renderAddress(); } });
  $('browserForward').addEventListener('click', () => { if (index < entries.length - 1) { index++; renderAddress(); } });
  $('browserRefresh').addEventListener('click', renderAddress);
  $('browserHome').addEventListener('click', () => { navigate(null); address.focus(); });
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
    if (!message || pending) return;
    const current = session;
    const row = addMessage('You', message);
    prompt.value = '';
    setPending(true);
    try {
      const result = await send(chatId, message);
      if (current !== session) return;
      chatId = result.chat.id;
      onChat(result);
      addMessage('NOIR', result.chat.messages.at(-1).text);
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
