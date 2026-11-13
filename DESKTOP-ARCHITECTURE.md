# NOIR desktop architecture plan

The current web agent accepts read and search adapters in research-agent.js. The public web adapter uses page-reader.js for pinned HTTPS retrieval and website-explorer.js for bounded navigation. search-service.js owns Brave requests. server.js owns accounts, task ownership, model calls, quotas, chat storage, and billing. browser.js owns the web workspace UI.

For the desktop release, keep the address bar, tab controls, and AI sidebar in a trusted app renderer. The Electron main process should own Chromium views and their sessions, with one controlled view per tab. Remote page renderers should use sandboxing and context isolation with Node integration disabled and no privileged preload. Store browser session data separately from NOIR account credentials and keep the latter in the platform credential store.

Keep public research on the existing service. Add a separate desktop adapter for user-approved reading from a selected tab. Scope approval to a tab, origin, task, and permitted action. Invalidate approval on unexpected navigation and exclude form inputs, passwords, cookies, and tokens from model context. Validate every IPC message and sender. Ask for separate confirmation before submitting forms, sending messages, purchasing, or changing account information.

Bind navigation, evidence, and cancellation to a task ID. Record actual tool results as sources. Keep auth and billing on the existing backend and keep provider keys server-side.

Before release, test permissions and session isolation, signed updates, platform packaging, and recovery from failed updates. Validate the build and installers independently on each supported platform.
