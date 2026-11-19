// Browser-owned recognition and synthesis. NOIR never records or uploads audio bytes.
export function spokenText(text) {
  return String(text).replace(/```[\s\S]*?```/g, ' Code or diagram omitted from speech. ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#>`~]/g, '').slice(0, 12000);
}
export function createSpeechController(host, { onState = () => {}, onTranscript = () => {}, onTurn = () => {} } = {}) {
  const Recognition = host.SpeechRecognition || host.webkitSpeechRecognition;
  let recognition, speaking, sequence = 0, recognized = '';
  const synth = host.speechSynthesis;
  function stopListening() {
    const current = recognition; recognition = undefined;
    if (current) { current.onresult = current.onend = current.onerror = current.onstart = null; try { current.abort(); } catch {} }
  }
  function stop() { sequence++; stopListening(); speaking = undefined; synth?.cancel(); onState('idle', 'Ready when you are.'); }
  return {
    supported: Boolean(Recognition), canSpeak: Boolean(synth && host.SpeechSynthesisUtterance),
    voices: () => synth?.getVoices() || [], stop,
    stopListening() { stopListening(); onState('idle', 'Microphone muted.'); },
    listen(language) {
      stop();
      if (!Recognition) { onState('error', 'Speech recognition is unavailable in this browser. You can still type your transcript.'); return; }
      const current = recognition = new Recognition();
      current.lang = language || host.navigator?.language || 'en-AU';
      recognized = '';
      current.interimResults = true; current.continuous = false;
      onState('starting', 'Waiting for browser microphone permission…');
      current.onstart = () => { if (recognition === current) onState('listening', 'Listening — speak now.'); };
      current.onresult = event => {
        if (recognition !== current) return;
        let text = ''; for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript + ' ';
        recognized = text.trim().slice(0, 12000);
        onTranscript(recognized);
      };
      current.onend = () => { if (recognition === current) { recognition = undefined; onState('idle', 'Speech captured.'); onTurn(recognized); } };
      current.onerror = event => {
        if (recognition !== current) return;
        stopListening();
        const errors = { 'not-allowed': 'Microphone permission was denied. Allow microphone access in browser site settings, or type instead.', 'service-not-allowed': 'Your browser blocked its speech service. You can type instead.', 'audio-capture': 'No microphone is available. Check your microphone settings.', network: 'The browser speech service could not connect. Try again or type instead.', 'no-speech': 'No speech was detected. Try again or type instead.', aborted: 'Listening stopped.' };
        onState('error', errors[event.error] || 'Speech recognition failed. Try again or type instead.');
      };
      try { current.start(); } catch { stopListening(); onState('error', 'Could not start the microphone. Try again or type instead.'); }
    },
    speak(text, voiceURI, settings = {}) {
      stop(); if (!synth || !host.SpeechSynthesisUtterance) { onState('error', 'Spoken responses are unavailable in this browser. Your reply is still saved in chat.'); return; }
      const chunks = speechChunks(spokenText(text));
      const version = sequence;
      const next = () => {
        if (version !== sequence) return;
        const text = chunks.shift();
        if (!text) { speaking = undefined; onState('idle', 'Response complete. Start listening for your next message.'); return; }
        const utterance = speaking = new host.SpeechSynthesisUtterance(text);
        utterance.rate = Math.max(.85, Math.min(1.15, Number(settings.rate) || 1));
        utterance.voice = synth.getVoices().find(voice => voice.voiceURI === voiceURI) || null;
        utterance.onend = next;
        utterance.onerror = () => { if (version === sequence) { sequence++; onState('error', 'Playback stopped. Read the response in chat or try Read response.'); } };
        onState('speaking', 'Speaking — microphone off.'); synth.speak(utterance);
      }; next();
    },
  };
}

export function speechChunks(text) {
  const sentences = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)].map(s=>s.segment) : [text];
  const chunks=[];let current='';for(const sentence of sentences){if(current.length+sentence.length>700&&current.trim()){chunks.push(current.trim());current='';}if(sentence.length>700){if(current.trim()){chunks.push(current.trim());current='';}let part='';for(const word of sentence.split(/\s+/)){if(part.length+word.length>700&&part){chunks.push(part);part='';}part+=(part?' ':'')+word;}if(part)current=part;}else current+=sentence;}if(current.trim())chunks.push(current.trim());return chunks;
}
export function chooseVoice(voices, preferred, language='en-AU') {
  const chosen=voices.find(v=>v.voiceURI===preferred);if(chosen)return chosen;
  const base=language.split('-')[0].toLowerCase();
  const score=v=>(v.lang?.toLowerCase()===language.toLowerCase()?30:v.lang?.toLowerCase().startsWith(base)?20:0)+(/premium|enhanced|natural|neural|siri/i.test(v.name)?50:0)+(/samantha|karen|daniel|moira|aria|jenny/i.test(v.name)?12:0)+(v.default?3:0)-(/bad news|bahh|boing|bubbles|cellos|bells|organ|trinoids|wobble|zarvox|whisper|jester/i.test(v.name)?100:0);
  const sameLanguage=voices.filter(v=>v.lang?.toLowerCase().startsWith(base));return [...(sameLanguage.length?sameLanguage:voices)].sort((a,b)=>score(b)-score(a))[0];
}
export function clampVoicePosition(x,y,width,height) {
  const safe=value=>Number.isFinite(value)?value:12;
  return {x:Math.max(12,Math.min(Math.max(12,width-76),safe(x))),y:Math.max(12,Math.min(Math.max(12,height-96),safe(y)))};
}
