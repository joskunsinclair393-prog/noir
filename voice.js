import { createSpeechController, chooseVoice, clampVoicePosition } from './voice-speech.js';
export function mountVoice({ input, send, cancel, busy, available, triggerHost }) {
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/voice.css'; document.head.append(style);
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'noir-voice-trigger'; trigger.title = 'Start NOIR Voice'; trigger.setAttribute('aria-label', 'Start NOIR Voice');
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>'; triggerHost.append(trigger);
  const widget = document.createElement('section'); widget.className = 'voice-float'; widget.hidden = true; widget.setAttribute('aria-label', 'NOIR Voice call');
  widget.innerHTML = `<button type="button" class="voice-orb" aria-label="NOIR Voice controls. Drag or use arrow keys to move." aria-expanded="false" aria-controls="voiceCallControls"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><g class="orb-wave"><rect x="18" y="27" width="4" height="10" rx="2"/><rect x="26" y="21" width="4" height="22" rx="2"/><rect x="34" y="24" width="4" height="16" rx="2"/><rect x="42" y="28" width="4" height="8" rx="2"/></g></svg></button><span class="voice-orb-caption">Ready</span>
    <div class="voice-call-controls" id="voiceCallControls" hidden><header><b>NOIR Voice</b><button type="button" data-action="collapse" aria-label="Collapse voice controls">×</button></header>
      <p class="voice-call-status" role="status" aria-live="polite">Microphone off.</p>
      <p class="voice-call-disclosure">Turn-based browser voice. Speech recognition and some voices may use external processing. NOIR stores sent text, not raw audio.</p>
      <button type="button" data-action="start" class="voice-call-primary">Start call</button>
      <div class="voice-call-actions"><button type="button" data-action="mic" aria-pressed="false">Mute mic</button><button type="button" data-action="stop">Stop response</button><button type="button" data-action="end" class="voice-call-end">End call</button></div>
      <label>Voice<select aria-label="Voice" id="voiceCallChoice"></select></label>
      <div class="voice-preview-row"><button type="button" data-action="preview">Preview voice</button><label>Speed<select aria-label="Voice speed"><option value="0.9">Relaxed</option><option value="1" selected>Natural</option><option value="1.1">Quick</option></select></label></div>
      <label class="voice-call-option"><input type="checkbox" data-option="review">Review transcript before sending</label>
      <label class="voice-call-option"><input type="checkbox" data-option="speech" checked>Spoken replies</label>
      <p class="voice-transcript" hidden></p><button type="button" data-action="send" hidden>Send edited transcript</button>
      <small>Voices are provided by your browser and device. Choose an enhanced or natural voice when available.</small>
    </div>`;
  document.body.append(widget);
  const orb = widget.querySelector('.voice-orb'), panel = widget.querySelector('.voice-call-controls'), status = widget.querySelector('.voice-call-status'), caption = widget.querySelector('.voice-orb-caption'), choice = widget.querySelector('#voiceCallChoice'), speed = widget.querySelector('[aria-label="Voice speed"]'), review = widget.querySelector('[data-option="review"]'), speech = widget.querySelector('[data-option="speech"]'), transcript = widget.querySelector('.voice-transcript');
  const button = action => widget.querySelector(`[data-action="${action}"]`);
  let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('noirVoicePreferences') || '{}') || {}; } catch {}
  let active = false, micMuted = false, pending = false, voiceRequest = false, sendRequest = send, cancelRequest = cancel, lastReply = '', draft = '', baseline = '', phase = 'idle', autoTimer, dragging, moved = false, requestVersion = 0;
  review.checked = prefs.review === true; speech.checked = prefs.muted !== true; speed.value = ['0.9','1','1.1'].includes(prefs.rate) ? prefs.rate : '1';
  const draftField = () => sendRequest === send ? input : document.querySelector('.studio-ask textarea') || input;
  const persist = () => { try { localStorage.setItem('noirVoicePreferences', JSON.stringify({ ...prefs, voice: choice.value, muted: !speech.checked, review: review.checked, rate: speed.value })); } catch {} };
  function expanded(value) { panel.hidden = !value; orb.setAttribute('aria-expanded', String(value)); positionPanel(); }
  function message(text) { status.textContent = text; orb.title = text + ' Click for controls; drag to move.'; }
  function positionPanel() { const r = widget.getBoundingClientRect(), height = window.visualViewport?.height || innerHeight, width = Math.min(310, innerWidth - 28); const below = height - r.bottom > r.top; panel.classList.toggle('below', below); panel.style.left = (Math.max(12, Math.min(innerWidth - width - 12, r.left > innerWidth / 2 ? r.right - width : r.left)) - r.left) + 'px'; panel.style.right = 'auto'; panel.style.maxHeight = Math.max(100, Math.min(570, below ? height - r.bottom - 30 : r.top - 30)) + 'px'; }
  function position(x, y, save = false) { const point = clampVoicePosition(x, y, innerWidth, window.visualViewport?.height || innerHeight); widget.style.left = point.x + 'px'; widget.style.top = point.y + 'px'; positionPanel(); if (save) { prefs.position = { x: point.x / Math.max(1, innerWidth - 76), y: point.y / Math.max(1, innerHeight - 76) }; persist(); } }
  function restorePosition() { position(prefs.position ? prefs.position.x * (innerWidth - 76) : innerWidth - 96, prefs.position ? prefs.position.y * (innerHeight - 76) : innerHeight - 160); }
  const updateMic = () => { button('mic').textContent = micMuted ? 'Unmute mic' : 'Mute mic'; button('mic').setAttribute('aria-pressed', String(micMuted)); };
  function resume() { clearTimeout(autoTimer); if (!active || micMuted || pending || document.hidden || !available()) return; autoTimer = setTimeout(() => { if (active && !micMuted && !pending && !busy() && !document.hidden && available()) listen(); }, 300); }
  const controller = createSpeechController(window, {
    onState(state, text) {
      const previous = phase; phase = state; widget.dataset.state = state;
      caption.textContent = ({ starting: 'Connecting', listening: 'Listening', speaking: 'Speaking', error: 'Paused', idle: micMuted ? 'Muted' : 'Ready' })[state] || 'Ready';
      if (!active) return; message(text);
      if (state === 'error') { micMuted = true; updateMic(); expanded(true); }
      if (state === 'idle' && previous === 'speaking') resume();
    },
    onTranscript(text) { if (!active) return; draft = (baseline ? baseline + ' ' : '') + text; const field = draftField(); field.value = draft; field.dispatchEvent(new Event('input', { bubbles: true })); transcript.textContent = draft; transcript.hidden = !draft; },
    onTurn(text) { if (!active || micMuted || !text.trim()) return; if (review.checked) { voiceRequest = true; message('Edit the transcript in your composer, then send.'); button('send').hidden = false; expanded(true); } else void submit(draft || text); },
  });
  function populate() {
    const voices = controller.voices(), selected = choice.value || prefs.voice;
    const best = chooseVoice(voices, selected, navigator.language);
    choice.replaceChildren(new Option(best ? 'Best available · ' + best.name : 'Browser default', ''));
    const locale = navigator.language?.split('-')[0] || 'en';
    const sorted = [...voices].sort((a, b) => Number(b.lang?.startsWith(locale)) - Number(a.lang?.startsWith(locale)) || a.name.localeCompare(b.name));
    for (const voice of sorted) choice.add(new Option(voice.name + ' · ' + voice.lang + (voice.localService ? ' · device' : ' · online'), voice.voiceURI));
    if (voices.some(v => v.voiceURI === selected)) choice.value = selected;
    button('preview').disabled = !controller.canSpeak;
  }
  function listen() {
    if (!active || pending || busy() || !available()) return;
    clearTimeout(autoTimer); baseline = draft.trim(); button('send').hidden = true; micMuted = false; updateMic();
    controller.listen(choice.value ? controller.voices().find(v => v.voiceURI === choice.value)?.lang : navigator.language);
  }
  function start() { if (!available()) return; active = true; prefs.callConsent = 1; persist(); button('start').hidden = true; micMuted = false; listen(); }
  function open(target = send, stop = cancel, initial = target === send ? input.value : '') {
    if (!available()) return;
    if (active && target === sendRequest) { expanded(panel.hidden); return; }
    if (active) { micMuted = true; voiceRequest = false; pending = false; requestVersion++; clearTimeout(autoTimer); controller.stop(); cancelRequest(); active = false; }
    sendRequest = target; cancelRequest = stop; draft = initial; widget.hidden = false; restorePosition(); populate(); active = true; trigger.setAttribute('aria-pressed', 'true');
    if (!controller.supported) { micMuted = true; widget.dataset.state = 'error'; caption.textContent = 'Unavailable'; updateMic(); button('start').hidden = true; message('Speech recognition is unavailable here. Type in the composer; spoken replies can still be previewed.'); expanded(true); return; }
    if (prefs.callConsent === 1) { expanded(false); start(); }
    else { expanded(true); micMuted = true; updateMic(); button('start').hidden = false; message('Choose Start call to allow your microphone. Spoken turns are sent automatically unless you enable transcript review.'); }
  }
  function end(preserveDraft = true) {
    active = false; voiceRequest = false; pending = false; requestVersion++; clearTimeout(autoTimer); micMuted = true; controller.stop(); cancelRequest(); widget.hidden = true; expanded(false); trigger.setAttribute('aria-pressed', 'false');
    if (!preserveDraft) { draft = ''; transcript.textContent = ''; } trigger.focus({ preventScroll: true });
  }
  async function submit(text) {
    if (!active || pending || busy() || !available() || !text.trim()) return;
    clearTimeout(autoTimer); pending = true; voiceRequest = true; button('send').hidden = true; const version = ++requestVersion;
    controller.stop(); phase = 'thinking'; widget.dataset.state = phase; caption.textContent = 'Thinking'; message('NOIR is thinking…');
    if (sendRequest === send) input.value = text;
    try { await sendRequest(text); }
    catch (error) { fail(error.message); }
    finally { if (version === requestVersion) { pending = false; if (active && voiceRequest) { voiceRequest = false; micMuted = true; updateMic(); message('No voice reply was received. Check chat, then unmute to retry.'); expanded(true); } else if (active && !speech.checked) resume(); } }
  }
  function fail(text) { if (!active) return; voiceRequest = false; pending = false; micMuted = true; clearTimeout(autoTimer); controller.stop(); updateMic(); widget.dataset.state = 'error'; caption.textContent = 'Paused'; message(text); expanded(true); }
  function reply(text) {
    if (!active || !voiceRequest) return; voiceRequest = false; pending = false; lastReply = text; draft = ''; transcript.hidden = true; button('send').hidden = true;
    if (speech.checked && !document.hidden) controller.speak(text, chooseVoice(controller.voices(), choice.value, navigator.language)?.voiceURI, { rate: Number(speed.value) });
    else { message('Response saved in chat.'); resume(); }
  }
  trigger.onclick = () => open(); button('start').onclick = start; button('collapse').onclick = () => expanded(false); button('end').onclick = () => end();
  button('mic').onclick = () => { if (!active) return; if (micMuted) { if (prefs.callConsent !== 1) start(); else listen(); } else { micMuted = true; clearTimeout(autoTimer); if (['starting','listening'].includes(phase)) controller.stopListening(); updateMic(); if (phase !== 'speaking' && phase !== 'thinking') message('Microphone muted.'); } };
  button('stop').onclick = () => { voiceRequest = false; pending = false; requestVersion++; micMuted = true; clearTimeout(autoTimer); controller.stop(); cancelRequest(); updateMic(); message('Stopped. Unmute when you are ready.'); };
  button('send').onclick = () => void submit(draftField().value || draft);
  button('preview').onclick = () => { micMuted = true; updateMic(); controller.speak('Hello. I’m NOIR. What would you like to work on?', chooseVoice(controller.voices(), choice.value, navigator.language)?.voiceURI, { rate: Number(speed.value) }); };
  choice.onchange = () => { prefs.voice = choice.value; persist(); }; review.onchange = persist; speed.onchange = persist;
  speech.onchange = () => { persist(); if (!speech.checked && phase === 'speaking') controller.stop(); };
  window.speechSynthesis?.addEventListener('voiceschanged', populate); populate();
  orb.onclick = () => { if (moved) { moved = false; return; } expanded(panel.hidden); };
  orb.onpointerdown = event => { if (event.button !== 0) return; const r = widget.getBoundingClientRect(); dragging = { x: event.clientX, y: event.clientY, left: r.left, top: r.top }; moved = false; orb.setPointerCapture(event.pointerId); };
  orb.onpointermove = event => { if (!dragging) return; const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y; if (Math.abs(dx) + Math.abs(dy) > 5) moved = true; if (moved) { position(dragging.left + dx, dragging.top + dy); event.preventDefault(); } };
  orb.onpointerup = () => { if (dragging && moved) { const r = widget.getBoundingClientRect(); position(r.left, r.top, true); } dragging = null; };
  orb.onpointercancel = () => { dragging = null; moved = false; };
  orb.onkeydown = event => { const offsets = { ArrowLeft: [-12,0], ArrowRight: [12,0], ArrowUp: [0,-12], ArrowDown: [0,12] }; if (offsets[event.key]) { event.preventDefault(); const r = widget.getBoundingClientRect(), [x,y] = offsets[event.key]; position(r.left + x, r.top + y, true); } if (event.key === 'Escape') expanded(false); };
  window.addEventListener('resize', () => { if (active) restorePosition(); }); window.visualViewport?.addEventListener('resize', () => { if (active) restorePosition(); });
  document.addEventListener('click', event => { if (active && !widget.contains(event.target) && event.target !== trigger && !trigger.contains(event.target)) expanded(false); });
  window.addEventListener('pagehide', () => end()); document.addEventListener('visibilitychange', () => { if (document.hidden && active) { micMuted = true; clearTimeout(autoTimer); controller.stop(); updateMic(); message('Paused while this tab is hidden. Unmute to continue.'); } });
  return { open, exit: end, processing() { if (active && sendRequest === send) { voiceRequest = true; pending = true; clearTimeout(autoTimer); controller.stop(); phase = 'thinking'; widget.dataset.state = phase; caption.textContent = 'Thinking'; message('NOIR is thinking…'); } }, isActive: () => active, reset() { end(false); lastReply = ''; draft = ''; }, reply, error: fail };
}
