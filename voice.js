import { createSpeechController } from './voice-speech.js';
export function mountVoice({ input, send, cancel, busy, available, triggerHost }) {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/voice.css'; document.head.append(stylesheet);
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'noir-voice-trigger'; trigger.title = 'NOIR Voice'; trigger.setAttribute('aria-label', 'Open NOIR Voice');
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
  triggerHost.append(trigger);
  const dialog = document.createElement('dialog'); dialog.className = 'noir-voice'; dialog.setAttribute('aria-labelledby', 'voiceTitle');
  dialog.innerHTML = `<header><span>NOIR.</span><button type="button" data-action="exit" aria-label="Exit voice mode" title="Exit voice mode">×</button></header>
    <div class="voice-intro"><p>SPACE TO SPEAK</p><h2 id="voiceTitle">Think out loud.</h2><p id="voiceStatus" role="status" aria-live="polite">Ready when you are.</p></div>
    <div class="voice-wave" aria-hidden="true">${Array.from({length:29},(_,i)=>`<i style="--bar:${12+Math.round(42*Math.sin((i+1)*1.7)**2)}px;--delay:${i*-.07}s"></i>`).join('')}</div>
    <label class="voice-label">Your transcript<textarea id="voiceTranscript" rows="3" maxlength="12000" placeholder="Speak, or type a thought…"></textarea></label>
    <div class="voice-controls"><button type="button" data-action="listen">Start listening</button><button type="button" data-action="send">Send transcript ↑</button><button type="button" data-action="stop">Stop</button></div>
    <div class="voice-options"><label>Response voice<select id="voiceChoice"><option value="">Browser default</option></select></label><button type="button" data-action="mute" aria-pressed="false">Mute responses</button><button type="button" data-action="read" disabled>Read response</button></div>
    <p class="voice-disclosure">Microphone starts only when you choose Start listening and allow browser access. Browser speech recognition may send audio to an external service. NOIR does not record or store raw audio. Sent text is saved in your existing chat history and uses your normal limits. Some playback voices may also use external processing.</p>`;
  document.body.append(dialog);
  const transcript = dialog.querySelector('#voiceTranscript'), status = dialog.querySelector('#voiceStatus'), choice = dialog.querySelector('#voiceChoice');
  const button = action => dialog.querySelector(`[data-action="${action}"]`);
  let muted = false, lastReply = '', voiceRequest = false, baseline = '';
  const controller = createSpeechController(window, {
    onState(state, message) { dialog.dataset.state = state; status.textContent = message; button('listen').disabled = busy() || ['starting','listening'].includes(state); transcript.readOnly = ['starting','listening'].includes(state); button('send').disabled = busy() || transcript.readOnly; },
    onTranscript(text) { transcript.value = (baseline + (baseline ? ' ' : '') + text).slice(0, 12000); },
  });
  const populate = () => {
    const selected = choice.value; choice.replaceChildren(new Option('Browser default', ''));
    for (const voice of controller.voices()) choice.add(new Option(voice.name + ' · ' + voice.lang + (voice.localService ? ' · on device' : ' · service'), voice.voiceURI));
    choice.value = selected; if (!choice.value) choice.value = '';
  };
  populate(); window.speechSynthesis?.addEventListener('voiceschanged', populate);
  function exit() { if (dialog.open && transcript.value.trim()) { input.value = transcript.value; input.dispatchEvent(new Event('input', { bubbles: true })); } voiceRequest = false; controller.stop(); if (dialog.open) dialog.close(); }
  trigger.onclick = () => { if (!available()) return; transcript.value = input.value; populate(); dialog.showModal(); status.textContent = controller.supported ? 'Ready when you are. Microphone is off.' : 'Speech recognition is unavailable in this browser. Type a transcript instead.'; transcript.focus(); };
  button('exit').onclick = exit;
  dialog.addEventListener('cancel', event => { event.preventDefault(); exit(); });
  dialog.addEventListener('close', () => { voiceRequest = false; controller.stop(); trigger.focus(); });
  button('listen').onclick = () => { if (busy() || !available()) return; baseline = transcript.value.trim(); controller.listen(); };
  button('stop').onclick = () => { voiceRequest = false; controller.stop(); if (busy()) cancel(); };
  button('mute').onclick = () => { muted = !muted; button('mute').setAttribute('aria-pressed', String(muted)); button('mute').textContent = muted ? 'Unmute responses' : 'Mute responses'; if (muted) controller.stop(); };
  button('read').onclick = () => { if (!muted && lastReply) controller.speak(lastReply, choice.value); };
  button('send').onclick = async () => {
    const text = transcript.value.trim(); if (!text || busy() || !available()) return;
    controller.stop(); input.value = text; voiceRequest = true; status.textContent = 'NOIR is thinking…'; dialog.dataset.state = 'thinking';
    button('send').disabled = button('listen').disabled = true;
    try { await send(text); } finally { if (dialog.open) { button('send').disabled = button('listen').disabled = false; if (voiceRequest) { voiceRequest = false; status.textContent = 'Check chat for the result. Your transcript is available to edit and retry.'; dialog.dataset.state = 'idle'; } } }
  };
  window.addEventListener('pagehide', exit);
  document.addEventListener('visibilitychange', () => { if (document.hidden) controller.stop(); });
  return { exit, error(message) { if (voiceRequest && dialog.open) { voiceRequest = false; controller.stop(); status.textContent = message; dialog.dataset.state = 'error'; } }, reply(text) { if (!voiceRequest || !dialog.open) return; voiceRequest = false; lastReply = text; transcript.value = ''; button('read').disabled = !controller.canSpeak; if (!muted) controller.speak(text, choice.value); else { dialog.dataset.state = 'idle'; status.textContent = 'Response saved in chat. Spoken responses are muted.'; } } };
}
