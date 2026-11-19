# NOIR Voice — floating call controls

The composer microphone starts a floating, draggable bubble instead of a modal. Click the bubble to reveal microphone mute/unmute, Stop response, End call, actual browser voice selection, voice preview, speed, spoken-response and transcript-review controls. Arrow keys move the focused bubble; its saved position is constrained to the viewport.

On first use, the small control panel explains external browser speech processing and asks the user to choose Start call. The browser then requests microphone permission. Later sessions still require an explicit click to start. No microphone or raw-audio recorder runs on page load. Hiding the tab pauses voice; ending, navigating away or signing out stops recognition/playback and pending voice generation.

By default, a completed recognized utterance is submitted through the existing chat API and saved as text. After the spoken reply ends, recognition resumes while the call is active and unmuted. This is turn-based browser speech, not simultaneous realtime audio. With Review transcript enabled, the recognized text stays editable in the existing Chat or Studio composer and waits for the user to send it. Normal beta checks, quotas and provider restrictions still apply.

The best available voice is selected using the device language, installed enhanced/natural voices and user preference. Novelty voices are deprioritized. Longer sentence groups reduce artificial playback breaks. Available voices and quality depend on browser/OS; NOIR does not supply proprietary Siri or ChatGPT audio, and no paid voice provider is enabled. Browser recognition and some voices can use external processing. NOIR does not store raw audio.

Focused tests cover explicit microphone activation, errors, finalized/aborted turns, playback cancellation, natural speech chunking, installed-voice selection and safe positioning. Real microphone input, browser speech-service availability and audible quality still require a manual check on the user's device.
