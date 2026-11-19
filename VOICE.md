# NOIR Voice (website only)

Open the microphone control in the chat composer. Opening voice mode does not activate the microphone. Choose Start listening, grant browser permission, review or edit the transcript, and choose Send transcript. Requests use the existing model selection, protected chat endpoint, quotas and saved text history. No raw audio is captured or stored by NOIR. Browser recognition and some playback voices may use external processing; this is disclosed before listening.

Stop cancels recognition, spoken playback and an active chat request. Exit and Escape stop recognition/playback; text generation already sent may finish in chat. Leaving the page, hiding the tab or signing out also stops voice activity. Unsent transcript text returns to the composer on exit. Voice mode never automatically restarts the microphone. The waveform indicates recognition/playback activity, not measured microphone amplitude. Voice selection uses the browser's available voices, labelled on-device or service.

Unsupported recognition, denied permission, no microphone, no speech and network errors display actionable messages with a typed-transcript fallback. Speech playback is independent of recognition support. Long responses are spoken in short chunks; code/diagram blocks are omitted from speech and remain available in chat.

## Verification

Run `node --test test/voice.test.js` and the full website suite. Controller tests use deterministic browser API doubles; they do not claim a real microphone or audio output was tested. Browser UI checks cover opening with microphone off, transcript editing, mute, stop and exit. Manually test recognition and playback in supported desktop browsers after signing into an approved account. Test allow/deny site permission, a real spoken request and reply, changing voices, Stop during generation/playback, Escape, sign-out and page navigation. Verify the browser microphone indicator turns off. Browser/OS speech-service availability varies.

No paid voice APIs, dependencies, database migration or desktop-browser changes.
