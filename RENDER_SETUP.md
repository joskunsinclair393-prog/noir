# NOIR website: Render setup

The existing `main` web service runs `npm install` and `npm start`. Do not deploy the Electron project. Keep the existing Supabase project and owner binding.

In Render → NOIR → Environment, configure secrets only on the server:

- `AUTH_REQUIRED=true`.
- Existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the service key must never be copied into frontend files).
- Existing `NOIR_OWNER_USER_ID`: the already-verified owner account UUID. Do not replace it with an email.
- `OPENROUTER_FREE_API_KEY`: an existing key permitted to use free models. Set provider account spending limits and never add payment details automatically.
- Optional `NOIR_THINK_MODEL`: an exact `vendor/model:free` ID. The server also checks current zero-price reasoning support. Omit it to discover an eligible free reasoning model. Think has no paid or non-reasoning fallback.
- Existing `MAX_OUTPUT_TOKENS` and chat timeout/usage settings apply to all AI work. The current 1,024-token free reply ceiling may leave too little budget for some reasoning models. A missing/limited provider produces an error; do not assume availability. Do not raise quotas without reviewing free-provider capacity.
- Preserve `PAID_AI_ENABLED=false`, `PREMIUM_MODEL_ACCESS_ENABLED=false`, `NOIR_PLUS_BILLING_ENABLED=false`. This update does not enable payments or alter prices.

Database additions already applied to the connected production project:
1. `supabase/studio.sql`: new private Studio tables, bounded projects/files, revision checks, roles, invitations and activity.
2. `supabase/beta-stages.sql`: keeps the active limit at five; enables owner-only expansion to 25 or 100 and feedback storage.
3. `supabase/studio-analytics.sql`: existing aggregated analytics extended for Think and Studio.

These migrations add tables/functions and widen checks without deleting existing accounts, chats, approvals or analytics. Apply migration files only once through the migration system. Back up before any destructive future change. Studio retains the last 20 saved revisions and 100 activity events per project. Existing account/chat retention remains unchanged.

## Manual release checks

Sign in as owner; open the logo dropdown → Studio; create/edit/export a document. Test a diagram, presentation and isolated prototype. Invite another already-approved beta tester with a viewer link, then change their role. Link delivery uses the user's email application, not an automatic email service. Invite acceptance requires the exact verified email and beta approval; it does not grant beta access.

Verify a real Instant and Think reply with the deployed key. A supported model listed in metadata can still be rate-limited or unavailable. Check Voice with a real microphone and speaker in supported desktop browsers. Test Office exports in Word/PowerPoint. Finish legal/privacy review before expanding. None of these manual checks are implied by deterministic tests.

Follow-up least-privilege migrations already applied: `supabase/studio-member-email.sql` and `supabase/owner-analytics-access.sql`. These avoid giving service_role direct access to auth.users; owner aggregate RPCs are fixed-path and executable only by service_role. Keep that restriction intact. Supabase's existing leaked-password-protection warning requires owner review before a wider launch; this update does not change that setting or activate a plan.
