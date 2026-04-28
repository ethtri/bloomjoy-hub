# Security Audit Spike for Issue #287

## Scope
This spike reviewed the current repo posture for auth and authorization boundaries, admin/reporting access, Supabase RLS/RPC/storage, Edge Functions, Stripe/Resend/WeCom integrations, environment handling, reporting/refund privacy, dependencies, GitHub Actions, and Vercel deployment headers.

No destructive testing, production load testing, secret rotation, raw customer data review, raw refund row review, payment identifier review, or sensitive report-content capture was performed.

## Findings by Severity

### P1
- **Supabase RPC authorization: legacy actor-parameter account RPCs trust caller-supplied actor IDs.** Tracked in #290. `security definer` RPCs in `202603220001_partner_operator_accounts.sql` accept `p_actor_user_id` and are granted to `authenticated`; they should bind actor authority to `auth.uid()` or be revoked from direct browser execution.
- **Edge Function redirect handling: checkout, billing portal, and invite URLs need host allowlists.** Tracked in #291. Stripe checkout/portal functions and the operator invite email flow accept caller-supplied URLs; allowed app origins should be enforced server-side.

### P2
- **Custom sticks artwork privacy: uploads are public and time-unbounded.** Tracked in #292. Public storage URLs are convenient but weak for customer logo/artwork privacy and abuse control.
- **Public intake abuse controls: lead/procurement notification paths need server-side throttling or challenge verification.** Tracked in #293. Client-only honeypot/idempotency does not protect direct Edge Function calls from notification amplification.
- **Deployment headers: Vercel config lacks browser security headers/CSP.** Tracked in #294. Add CSP/frame/referrer/content-type/permissions/HSTS headers without breaking Stripe, Supabase, Vimeo, or app-shell flows.
- **Dev dependency audit findings remain open.** Already tracked in #200. Full `npm audit` reports moderate Vite/esbuild dev-server advisories; `npm audit --omit=dev` reports zero production vulnerabilities.

### P3
- **GitHub Actions hardening: CI/migration workflows should explicitly minimize token permissions and consider action pinning.** Tracked in #295.

## Finding Classification
- **Confirmed code-level security defects:** #290 and #291 are confirmed from static review of current repo code. Production exploitability was not tested.
- **Confirmed privacy or abuse-control gaps:** #292 and #293 are confirmed from current storage/function behavior and should be remediated as hardening work before the related flows scale.
- **Defense-in-depth improvements:** #294 and #295 reduce browser and supply-chain risk but are not tied to a confirmed data exposure in this spike.
- **Open questions needing owner or environment verification:** production Supabase policy state, deployed secret configuration, vendor-owned auth/email/WeCom settings, and production header behavior were not tested directly.

## Already-Covered or Non-Duplicated Items
- Production auth email/OAuth/custom-domain hardening remains tracked in #77.
- WeCom reliability and production owner-controlled WeCom policy remain tracked in #110.
- Longer-term account/role/entitlement consolidation remains tracked in #150, with Partner Viewer boundaries in #128.
- Refund canonical machine identity remains tracked in #243.
- No repo-committed secrets or client-exposed `VITE_` server secrets were found in the audited files.
- Supabase tables created in migrations were found to have RLS enabled; this spike did not run live database introspection against production.

## Current Status Impact
`Docs/CURRENT_STATUS.md` was not changed because this spike created prioritized security follow-ups but did not confirm a new P0 launch blocker. The highest-priority new items are #290 and #291.

## Verification Notes
- `npm ci`: passed; full install still reports the 2 moderate dev dependency advisories covered by #200.
- `npm run auth:preflight`: failed in this worktree because no local `.env`/`.env.local` was loaded for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `npm run commerce:preflight`: failed in this worktree because local server-side commerce secrets are intentionally not present.
- `npm run build`: passed.
- `npm test --if-present`: passed; no test script produced output.
- `npm run lint --if-present`: passed with the existing 8 fast-refresh warnings in generated/shared UI and auth files.
- `npm audit`: found 2 moderate dev dependency advisories already covered by #200.
- `npm audit --omit=dev`: passed with 0 production vulnerabilities.
