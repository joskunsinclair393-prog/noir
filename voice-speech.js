// Browser-owned recognition and synthesis. NOIR never records or uploads audio bytes.
export function spokenText(text) {
  return String(text).replace(/```[\s\S]*?```/g, ' Code or diagram omitted from speech. ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#>`~]/g, '').slice(0, 12000);
}
export function createSpeechController(host, { onState = () => {}, onTranscript = () => {} } = {}) {
  const Recognition = host.SpeechRecognition || host.webkitSpeechRecognition;
  let recognition, speaking, sequence = 0;
  const synth = host.speechSynthesis;
  function stopListening() {
    const current = recognition; recognition = undefined;
    if (current) { current.onresult = current.onend = current.onerror = current.onstart = null; try { current.abort(); } catch {} }
  }
  function stop() { sequence++; stopListening(); speaking = undefined; synth?.cancel(); onState('idle', 'Ready when you are.'); }
  return {
    supported: Boolean(Recognition), canSpeak: Boolean(synth && host.SpeechSynthesisUtterance),
    voices: () => synth?.getVoices() || [], stop,
    listen(language) {
      stop();
      if (!Recognition) { onState('error', 'Speech recognition is unavailable in this browser. You can still type your transcript.'); return; }
      const current = recognition = new Recognition();
      current.lang = language || host.navigator?.language || 'en-AU';
      current.interimResults = true; current.continuous = false;
      onState('starting', 'Waiting for browser microphone permission…');
      current.onstart = () => { if (recognition === current) onState('listening', 'Listening — speak now.'); };
      current.onresult = event => {
        if (recognition !== current) return;
        let text = ''; for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript + ' ';
        onTranscript(text.trim().slice(0, 12000));
      };
      current.onend = () => { if (recognition === current) { recognition = undefined; onState('idle', 'Review your transcript, then send.'); } };
      current.onerror = event => {
        if (recognition !== current) return;
        stopListening();
        const errors = { 'not-allowed': 'Microphone permission was denied. Allow microphone access in browser site settings, or type instead.', 'service-not-allowed': 'Your browser blocked its speech service. You can type instead.', 'audio-capture': 'No microphone is available. Check your microphone settings.', network: 'The browser speech service could not connect. Try again or type instead.', 'no-speech': 'No speech was detected. Try again or type instead.', aborted: 'Listening stopped.' };
        onState('error', errors[event.error] || 'Speech recognition failed. Try again or type instead.');
      };
      try { current.start(); } catch { stopListening(); onState('error', 'Could not start the microphone. Try again or type instead.'); }
    },
    speak(text, voiceURI) {
      stop(); if (!synth || !host.SpeechSynthesisUtterance) { onState('error', 'Spoken responses are unavailable in this browser. Your reply is still saved in chat.'); return; }
      const chunks = spokenText(text).match(/[^.!?\n]{1,240}[.!?\n]?/g) || [];
      const version = sequence;
      const next = () => {
        if (version !== sequence) return;
        const text = chunks.shift();
        if (!text) { speaking = undefined; onState('idle', 'Response complete. Start listening for your next message.'); return; }
        const utterance = speaking = new host.SpeechSynthesisUtterance(text);
        utterance.voice = synth.getVoices().find(voice => voice.voiceURI === voiceURI) || null;
        utterance.onend = next;
        utterance.onerror = () => { if (version === sequence) { sequence++; onState('error', 'Playback stopped. Read the response in chat or try Read response.'); } };
        onState('speaking', 'Speaking — microphone off.'); synth.speak(utterance);
      }; next();
    },
  };
}
