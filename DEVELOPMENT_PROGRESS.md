# NOIR development progress — 19 November 2026

Restore point: `codex/restore-before-studio-2026-11-19` at `56c184a1640e17a6c2635d4fe5efd3fb92430629`. This preserves the published source; no environment secrets were copied into Git.

## Phase 1 — navigation and response modes
Implemented: logo dropdown for Chat / Studio; website Browser navigation hidden without deleting its code; Verify/Challenge removed from prominent sidebar positions while message actions/backend remain. Separate Instant/Think selector. Think discovers zero-price free reasoning models, requests real provider reasoning parameters, excludes private reasoning, never retries through non-reasoning/paid routes. Timer reflects actual request duration and existing Stop cancels generation.
Files: response-modes.js, free-cloud.js, workspace.js, workspace.css, server.js, script.js.
Tests: three focused response-mode tests pass. Provider credentials/live reasoning inference still require separate verification; quota-limited 1024-token responses may be too short for some reasoning models. Unsupported/no-available reasoning produces an explicit error. Desktop Electron UI is unchanged.

## Phase 2 — Voice
Implemented: saved browser voice and mute preferences; voice previews; microphone mute during listening; existing turn-based recognition, editable transcripts, playback/stop/exit and disclosure preserved.
Files: voice.js. Four deterministic speech-controller tests pass. Real hardware microphone and audible playback not tested in this run.

## Phases 3–5 — Studio implementation in progress
Implemented in source: three-panel private projects/files/folders; editable text and JSON content; autosave; optimistic revision conflicts; local undo/redo; last 20 saved versions; document preview; reused interactive diagrams; slide previews/reordering/themes; isolated frontend website prototypes; real DOCX/PPTX/ZIP/SVG/PNG/PDF export helpers. PDF is rasterized, not searchable text. Office application compatibility requires manual testing.
Server-side project permissions and email-bound seven-day invitations use additive Supabase tables and a service-role-only RPC. Invitations open the user's mail application; NOIR does not automatically send mail or purchase email infrastructure. Members must also meet existing verified-email beta restrictions. Polling synchronizes clean, unfocused editors; conflicted/unsaved work is never silently replaced. No simultaneous cursor/presence claims.
Files: studio.js, studio.css, studio-model.js, studio-exports.js, supabase/studio.sql, server.js, script.js, test/studio.test.js.
Database: additive migration `private_studio_projects_and_permissions` applied. No existing accounts, chats, permissions or billing records were changed. No destructive migration.
Tests: validation/export signatures pass; database permissions/transaction tests and browser testing are being completed. Full local website suite currently 82/82 passing.

## Remaining work before final report
- Finish diagram styling controls and Studio voice bridge.
- Validate Office ZIP/XML files and actual PDF rendering, preview isolation, invitations/expiry/revocation.
- Add focused HTTP authorization tests for Studio and Think; browser-check the complete workspace.
- Owner-configurable beta stages (default five, no automatic expansion), feedback, Render setup guide.
- Update homepage accurately, privacy/terms drafts, LAUNCH_PLAN.md, release checklist.
- Run exact-release regression tests, inspect changed files, deploy only the reviewed website files and verify Render SHA.

Next development step: complete exports and Studio browser/security verification before publishing.

## Phases 3–5 — source implementation and verification update

Added genuine binary DOCX/PPTX/ZIP exporters and client-rendered PDF/SVG/PNG downloads. ZIP CRC and all exported XML parts parse successfully. An actual browser-generated PDF was parsed by `pdfinfo`: valid one-page A4 PDF, no embedded JavaScript. Documents support editing individual preview sections; slide titles/bodies are editable, with thumbnails, reordering, themes and presentation mode. Diagram JSON, accent color and horizontal/vertical layout controls reuse the existing safe renderer. Website source is editable JSON with three files and isolated interactive previews. JavaScript runtime/parse errors are reported; this is not a complete static linter or guarantee that every requested feature was generated.

Browser test fixture checks: workspace switching, document editing/save, PDF download, chart rendering, interactive website button, slide reordering and theme changes. Actual sandbox checks passed: parent document inaccessible, credential storage inaccessible, fetch blocked. The parent CSP uses per-response nonces for authorized sandbox scripts, rather than broadly enabling inline application scripts. Fixture tests do not claim signed-in production E2E success.

Real transactional database tests passed for cross-user isolation, wrong-email invitation rejection, viewer read-only access, editor saving, version recovery, stale-revision conflicts and revoked member denial. All changes rolled back. Shared invitations are manual email-client delivery, not automatic email dispatch. No real-time presence/cursors implemented or advertised.

## Phase 6 — protection and beta controls

Default access remains five testers, excluding the verified owner. Owner-only stage controls support five/25/100, with no automatic approvals or expansion. A database trigger enforces the configured slot limit even through legacy review controls. New feedback collection requires explicit user submission/consent; feedback is owner-only. Think/Studio usage enters the existing aggregated usage records and message totals, preserving old analytics. Existing quotas, rate limits, request deadlines, provider secrets and paid/billing locks remain intact.

Migrations applied: `private_studio_projects_and_permissions`, `owner_controlled_beta_stages_and_feedback`, `include_studio_and_think_in_private_usage_analytics`. These add functionality without deleting existing records. Fresh migration SQL may replace check constraints atomically but does not drop tables or user data. Current tester limit verified as five. Authenticated clients have no direct Studio table/RPC access.

## Phase 7 — launch preparation underway

Homepage gains an honest local Studio editing demonstration and a clearly labelled turn-based Voice/mode section while keeping existing giant logo, laptop, smartphone and scroll content. Added public beta information, Render setup instructions, privacy/terms drafts and `LAUNCH_PLAN.md`. No promotional posts or emails sent. No paid services activated.

Remaining verification: full exact-release suite after final edits; browser rerun of section editing/presentation mode/updated light/mobile layouts; SQL expiry/revocation/stage-limit tests; live post-deploy smoke checks. Signed-in production creation/sharing and real provider/voice-hardware/Office compatibility remain manual checks requiring the appropriate sessions/devices. Do not label this public-launch ready until those pass and privacy/terms/capacity are reviewed.

## Final verification and known limitations

- Full local website regression suite: **84 tests passed**, zero failed before final navigation/error-state checks. Exact deployment suite: **76 passed**, zero failed (eight newer unrelated local server tests are intentionally not copied into production).
- Browser UI fixture: saved section-level document edits, confirmed presentation Previous/Next, reordered slides, changed themes, downloaded an actual PNG diagram and PDF. Studio light mode checked. At 390px viewport, page width and Studio width were both exactly 390px (no horizontal overflow). Returned successfully to Chat. These are local fixture checks, not a claim of live authenticated E2E testing.
- Database role test caught a real permission issue: service_role cannot read auth.users. Studio member emails now come from the verified invitation acceptance, without widening auth-table grants. Existing owner analytics use narrowly exposed, fixed-search-path aggregate functions restricted to the server role. Actual service-role project create/read/save, owner analytics and Studio/Think tracking passed in a rolled-back transaction.
- Invitation expiry/revocation and manual beta-stage expansion/reduction protections passed in rolled-back transactions. Active production cap remains **five**, with zero temporary Studio projects left behind. No accounts/chats were deleted or testers automatically approved.
- Security advisor: no new public table grants. RLS-with-no-policy notices are expected for server-only tables whose anon/authenticated privileges are revoked. Existing leaked-password protection warning remains; owner should review the Supabase setting before expansion. No setting or paid service was enabled automatically.

Completed baseline functionality across phases 1–7 is implemented in source. This is not a claim that every advanced feature is production certified. Remaining manual release gates: signed-in owner + second approved-user E2E sharing flow, real configured Instant/Think responses, real microphone/speaker behavior, Word/PowerPoint application compatibility, broader device testing, storage/provider-capacity review and final privacy/terms/contact/deletion process review. Freeform infographic design, simultaneous shared cursors/presence, automatic email delivery, complex hosted websites/backends and fully styled rich document layout are not implemented or advertised. PDF supports A4/Letter/landscape, font-size and margin choices, with flattened output.

Required next step after deployment: verify the deployed SHA and protected endpoints, then have two approved accounts perform the manual release-gate checklist in RENDER_SETUP.md. Keep the beta at five until that succeeds; do not invite 100 users based only on automated tests.

## Floating Voice update — 19 November 2026

Replaced the modal Voice interface with a draggable, keyboard-movable monochrome bubble and compact call controls. Added automatic turn submission/resumption with optional review in the existing composer, microphone mute, response stop, End call, real browser voice selection, preview and speed controls. Enhanced/natural installed voices are preferred; no proprietary voice service or paid API was added. Sentence grouping improves continuity. Chat/Studio send paths, quotas and beta checks are reused. New speech finalization, aborted-turn, voice-ranking and viewport-bound tests added. Physical microphone/audible quality remain manual checks.

## Studio removed from the user-facing website — 20 November 2026

Removed Studio navigation, logo dropdown, chat save actions, module initialization, polling, homepage promotion and SEO claims. Chat, Voice, Instant, Think, Smart Route, existing chat Projects and account features remain. Old Studio page/query links redirect to `/app`; disabled asset routes return 404, and authenticated Studio API/context requests return 410 before any project access. Anonymous requests still require authentication. Studio is disabled by default; isolated backend tests explicitly enable the preserved implementation through trusted server configuration only. All Studio source files, database tables and stored data remain unchanged. No migration or data deletion. Updated SEO retains the Google verification tag. Added focused disablement/redirect/no-storage-call tests.
