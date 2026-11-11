# NOIR

NOIR is an open-source chat app with a Node.js backend. It can use Google Gemini, OpenAI, or Groq, supports required account sign-in for a public deployment, keeps chats separated by account, and keeps provider keys out of browser code.

## Requirements

- Node.js 20 or newer
- For AI replies, an API key from the provider you choose
- For a public website, a Supabase project and credentials for the sign-in providers you enable

The project uses Node’s built-in libraries, so it has no third-party packages to install.

## Start NOIR

On macOS, double-click **`Start NOIR.command`** in the project folder. It creates `.env` from the template if needed, starts the local server, and opens the browser. Keep the Terminal window open while using NOIR; press **Ctrl+C** there to stop the server. The template requires account sign-in, so you’ll need to configure Supabase first. To use a private local demo without accounts, set `AUTH_REQUIRED=false` in `.env`.

You can also start it manually:

1. Open Terminal and go to the project folder. For example:

   ```sh
   cd ~/Downloads/noir_chat
   ```

2. Create your private settings file:

   ```sh
   cp .env.example .env
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env`.

3. Open `.env` in a text editor. Choose a provider and model. For a public website, also add the Supabase project URL and public anon key. Leave `ALLOW_BILLABLE_REQUESTS=false` until you have checked the provider’s pricing and account settings.

4. Start the app:

   ```sh
   npm start
   ```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Stop the server with **Ctrl+C** in Terminal.

## Choose an AI provider

The website does not need redesigning to switch providers. Change `AI_PROVIDER`, `AI_MODEL`, and the matching key in `.env`, then restart the server.

### Groq

Set:

```dotenv
AI_PROVIDER=groq
AI_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=your_key_here
```

Create a key in the [Groq Console](https://console.groq.com/keys). Groq offers a free tier with rate limits; moving to its paid Developer tier requires a payment method. Check the current [rate limits](https://console.groq.com/docs/rate-limits). NOIR sends Groq requests only when `ALLOW_BILLABLE_REQUESTS=true`; that switch permits API calls but does not add a payment method or upgrade the Groq account.

### Google Gemini

Set:

```dotenv
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your_key_here
OPENAI_API_KEY=
```

Create a key in [Google AI Studio](https://aistudio.google.com/apikey). Google offers free usage for some models and accounts, but availability and quotas vary. Check the model’s current [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and your project’s usage limits before enabling requests.

### OpenAI

Set:

```dotenv
AI_PROVIDER=openai
AI_MODEL=your-chosen-model
OPENAI_API_KEY=your_key_here
GEMINI_API_KEY=
```

Create an API key in the [OpenAI API platform](https://platform.openai.com/api-keys). API access and ChatGPT subscriptions are separate. OpenAI API requests may incur charges; check the current [API pricing](https://developers.openai.com/api/docs/pricing) for the model you select.

### Explicitly enable provider requests

NOIR starts with provider requests disabled. After you have reviewed the selected model, its price, and your account’s billing state, set:

```dotenv
ALLOW_BILLABLE_REQUESTS=true
```

This only allows NOIR to send API requests. It does **not** create a paid account, add a payment method, or enable billing with a provider. If the provider account has billing enabled, usage may be charged under that provider’s terms. The project does not change provider account settings.

## Token usage and credits

- NOIR reads input and output token counts from the selected provider’s response metadata. Total usage is available in the account menu beside Settings; counts are not shown alongside chat messages.
- Credits are a separate, optional NOIR limit. With the example settings, a new browser session starts with 100 credits and a successful response costs 1 credit. Failed responses do not spend credits.

The chat interface supports searchable saved conversations, Markdown-style response formatting, copyable code blocks, and edit/regenerate controls for the latest turn. Appearance, compact messages, prompt suggestions, and Enter-to-send preferences are saved in the browser.

## NOIR Plus billing (Stripe test mode)

NOIR Plus is **$15 AUD/month**, billed monthly by Stripe Checkout. The server verifies webhook signatures and stores subscription state in the private `noir_subscriptions` table. A successful browser redirect alone never grants Plus. Cancellation and billing changes are handled through Stripe’s hosted customer portal and verified webhook events. NOIR does not receive or store card numbers.

The daily free quota remains controlled by `MAX_DAILY_TOKENS`; do not change its existing value when enabling Plus. A value of `0` disables NOIR's quota. Plus removes only NOIR’s daily quota, optional per-account throttle, and optional NOIR credit cap. Provider quotas, model availability, safety systems, and shared service fair-use safeguards continue to apply. If a payment becomes past due, Plus access pauses until Stripe confirms the subscription is active again. A cancellation scheduled at the end of a period remains active until that period ends.

To configure payments safely:

1. Create or use a Stripe account **in test mode**. Add a recurring product price of exactly **$15 AUD every month**, then copy its `price_...` ID.
2. Copy `.env.example` to `.env`. Set `STRIPE_MODE=test`, `STRIPE_SECRET_KEY` to a test secret key beginning `sk_test_`, `STRIPE_PRICE_ID` to the test price ID, and `PUBLIC_APP_URL` to the URL NOIR is running on. `ALLOW_LIVE_STRIPE` must remain `false`.
3. Add `https://YOUR-NOIR-HOST/api/stripe/webhook` as a webhook destination in the Stripe **test** dashboard. Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, and `invoice.payment_failed`. Copy its `whsec_...` signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Apply the `supabase/schema.sql` update (or the `noir_plus_billing_setup` migration) so the backend can save verified subscription and webhook state. The subscription tables have RLS enabled and grant access only to the server role.
5. In Stripe test mode, complete Checkout using a Stripe test card (for example `4242 4242 4242 4242`, any future expiry and CVC). Use Stripe’s test dashboard/portal to test cancellation, renewal, and failed payments. Test values do not move real funds. See [Stripe’s testing guide](https://docs.stripe.com/testing) and [subscription testing guide](https://docs.stripe.com/billing/testing).

For local webhooks, install Stripe CLI and run `stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook`; put the signing secret printed by the CLI into `STRIPE_WEBHOOK_SECRET`. This CLI signing secret is different from a Dashboard endpoint secret. Stripe’s test webhook events and local mock tests never use live payment keys.

The customer portal must be enabled in the same Stripe test environment. Configure its subscription cancellation and payment-method features in Stripe Dashboard. NOIR’s **Manage subscription** button creates a short-lived portal session for the signed-in account.

Live billing is deliberately gated. NOIR refuses live Stripe keys unless the server owner intentionally sets both `STRIPE_MODE=live` and `ALLOW_LIVE_STRIPE=true`. Leave these off during development. Stripe secret keys and webhook secrets belong only in server or host environment variables, never in browser code or Git.
- For trusted accounts that should bypass the in-app credit limit, set `UNLIMITED_ACCESS_EMAILS` to a comma-separated list of verified account email addresses on the server. Keep this setting private; never add real addresses to source control or frontend code. It removes only the NOIR credit limit and does not bypass sign-in or provider rate limits.
- Change `ENABLE_CREDITS`, `STARTING_CREDITS`, and `CREDITS_PER_MESSAGE` in `.env` to adjust this. Credit values and token totals are stored and updated by the server; the browser cannot submit a replacement balance.

## Accounts and social sign-in

The example `.env` requires a verified account for chat APIs. NOIR uses Supabase Auth for account registration and sign-in. The welcome screen offers email/password, Google, Apple, and GitHub. The sign-in provider buttons work after you enable and configure the matching providers in your Supabase project; the provider's OAuth client secrets stay in Supabase and are never added to this app.

1. Create a Supabase project. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor. Copy the Project URL, public anon/publishable key, and service-role key into `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env` or your host's private environment settings. The service-role key is server-only; never put it in browser code or publish it.
2. In Supabase Auth, set your public website as the Site URL and add both your public URL and `http://127.0.0.1:3000/**` to the redirect URL allow list.
3. Enable Email and the social providers you want in the Supabase Auth provider settings. Add the required OAuth client ID and secret from Google, Apple, or GitHub in the provider's settings. Follow Supabase's provider-specific callback instructions. Apple web sign-in also requires Apple Developer configuration and periodic secret rotation.
4. Keep `AUTH_REQUIRED=true`. NOIR verifies each account with Supabase on the backend before it reads or changes chats. The backend only returns the Supabase URL and public key to the browser; it never returns a service-role key.
5. For public email registration, configure a production email/SMTP provider in Supabase so account verification messages can reach users.

Supabase's [Google sign-in guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Apple sign-in guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple), and [PKCE flow documentation](https://supabase.com/docs/guides/auth/sessions/pkce-flow) explain provider callback and redirect configuration. The app uses the authorization-code PKCE flow for social sign-in.

## Public deployment

The project includes a `render.yaml` Blueprint for a small free web service in Singapore. To publish it:

1. Create a Supabase project on a plan you choose and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. Configure Supabase Auth, the site URL, allowed redirects, and the Email/Google/Apple/GitHub providers you want to offer. Social providers require OAuth credentials from the matching provider's developer settings.
3. Publish this repository to GitHub, then open Render's Blueprint flow and select the repository. Render will prompt for the Supabase URL, public anon key, and private service-role key. Enter them in Render's secret fields; don't commit them.
4. Verify the app starts and that account registration works. AI requests stay blocked until you separately add a provider key and opt in to provider requests.

The free Render service sleeps after inactivity, so the first page load after a quiet period can be slow. Supabase Free projects may also pause after a week without activity. These free tiers have usage limits and are suitable for getting started, not a promise of uninterrupted production service.

When `SUPABASE_SERVICE_ROLE_KEY` is configured, account data is saved in the private `noir_user_data` database table; otherwise, the included JSON store needs a persistent disk. Keep a single server instance so the in-memory rate limits and account locks are shared.

NOIR does not deploy itself or create a public website account. You choose and configure the source-code host, app host, domain, Supabase project, and provider accounts. Hosting services, domains, OAuth accounts, email delivery, and AI APIs may have charges. Review the prices before enabling anything paid. AI generation stays blocked until `ALLOW_BILLABLE_REQUESTS=true`; that setting may result in provider charges when a user chats. The public server also has a shared rate limit (`MAX_PUBLIC_REQUESTS_PER_MINUTE`, default 20) and per-account message limit, but those limits do not guarantee a maximum bill.

## Chats and local data

Chat history, token usage, and credit balances are saved in `data/noir-data.json`, keyed by the signed-in account when `AUTH_REQUIRED=true`. In local demo mode, the browser receives an HttpOnly session cookie instead. The server listens on `127.0.0.1` by default unless `HOST` is changed for deployment.

Each account receives its own chats and starting credits. Clearing browser sign-in storage requires signing in again; it does not erase the server-side account data. This version uses a JSON file for chat persistence and is intended for one server instance. A larger public service should move chat storage to a managed database and add account deletion and abuse monitoring.

The connector and plugin menus, and file selection controls, are still interface previews. This version sends typed text to the AI provider; it does not upload file contents or connect third-party services.

If you open `index.html` by double-clicking it, the browser uses a `file://` address and cannot reach the Node backend. Start NOIR with `Start NOIR.command` or `npm start`, then use the `http://127.0.0.1:3000` address.

## Files

- `index.html` — NOIR chat interface
- `styles.css` — dark and light themes, responsive layout
- `script.js` — browser UI and same-origin API calls
- `server.js` — Node server, Gemini/OpenAI adapters, account sign-in checks, chats, usage and credits
- `supabase/schema.sql` — private PostgreSQL table for durable account data
- `render.yaml` — free Render web service Blueprint
- `.env.example` — safe configuration template (copy to `.env`)
- `.gitignore` — excludes `.env` and local server data
- `Start NOIR.command` — macOS one-click local server launcher
- `logo.svg` — NOIR logo
- `LICENSE` — MIT open-source license
- `test/` — provider and backend tests using mocked provider responses

## Run tests

```sh
npm test
```

Tests use mock Gemini/OpenAI responses, so they do not need API keys and do not use provider credits. A live AI request can only be checked after you configure your own key and explicitly enable requests.

## ZIP the project

From the project folder, run:

```sh
zip -r NOIR.zip index.html styles.css script.js server.js package.json .env.example .gitignore README.md LICENSE "Start NOIR.command" logo.svg logo.svg.png supabase test
```

The command excludes your private `.env`, local chat database, and `.git` history.
