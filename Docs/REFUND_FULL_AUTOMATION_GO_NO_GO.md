# Refund Full Automation Go/No-Go Packet

Last updated: 2026-05-13

## Purpose
Use this packet to separate PR `#432` code-merge readiness from production shadow-pilot and cutover readiness. Merging the PR is not cutover approval; Google Form/AppSheet remains the fallback until the shadow pilot is clean.

## Current Status
- PR `#432` is code-merge ready after QA hardening, green GitHub/Vercel checks, and PM/PO closeout. Production shadow-mode proof still needs real operational data and functional UAT before sponsor proof review or cutover.
- GitHub CI, Vercel, and the GitHub Supabase migration workflow are green for the PR head SHA.
- Local mocked/demo browser UAT passed for public refund intake, thank-you page, Portal > Refunds, and Admin > Machines Machine Manager setup. The latest Admin > Machines harness also proves the setup-capable flow for enabling selected machines on the public refund form, setting an optional customer-facing label, and saving read-only Nayax lookup IDs without enabling live card refunds. This is useful visual evidence, but seeded functional UAT or post-deploy shadow smoke is still required for real saves, automated messages, access boundaries, Nayax lookup, and reporting write-through.
- Independent QA on 2026-05-13 returned no-go findings for public-intake readiness gates, Snapcase/Commercial-Mini scope enforcement, and caller-supplied Nayax lookup fields. The branch now hardens those paths with a forward migration, Edge Function scope checks, UI readiness blocks, and static validators. Re-run GitHub CI and Docker-backed migration validation after this patch lands.
- Production shadow-mode setup was approved and executed on 2026-05-13: refund secrets are present, the approved migration train was applied, and refund Edge Functions were deployed. No live Nayax refund execution was enabled.
- Nayax lookup evidence is tokenized before it reaches the browser. Raw Nayax provider transaction IDs stay server-side and are resolved only by the refund admin Edge Function.
- The Admin > Machines refund-readiness setup migration was applied to production on 2026-05-13. Post-apply dry-run reports the remote database is up to date.
- The new refund scope/readiness hardening migration is pending after QA. GitHub migration validation is green; apply it before any public intake enablement.
- Production data-readiness smoke currently shows 26 active Sunze-backed Commercial/Mini reporting machines, but 0 refund-intake-enabled machines, 0 Nayax lookup mappings, 0 active Machine Manager assignments, and 0 refund cases. Selected shadow UAT is blocked until machine setup data is added.
- The read-only pilot readiness audit and cohort config helper now have repeatable commands in `Docs/REFUND_PRODUCTION_SHADOW_SETUP.md`. Latest sanitized production audit result: 26 active reporting machines, 0 refund-intake-enabled machines, 0 public refund selector options, 0 Nayax lookup mappings, 0 active Machine Manager assignments, 0 refund cases, 43 Nayax inventory machines fetched, 38 local mapping-candidate rows generated, and a 26-row local pilot cohort template generated/dry-run with no selected rows. Sponsor-provided manager mapping has also been reconciled locally: 14 rows have proposed Nayax IDs, 12 rows still need Nayax IDs before card-capable intake, and the Annie/Steve manager accounts need to authenticate before roster apply can pass. No production data was changed.

## Latest Production Preflight Result
`npm run commerce:preflight -- --project-ref ygbzkgxktzqsiygjlqyg --include-refunds` was refreshed after production secret setup on 2026-05-13 and passed. Remote secret inspection validates presence only; fail-closed values were set during setup and live execution remains disabled.

## PR Merge-Ready Gates
Move PR `#432` out of draft only after all of these are true:
- Production remote secrets pass `npm run commerce:preflight -- --project-ref ygbzkgxktzqsiygjlqyg --include-refunds`. Complete 2026-05-13.
- GitHub CI, Vercel, and GitHub Supabase migration validation are green on the final PR head. Complete 2026-05-13.
- `npm ci`, build, lint, test, SEO, security/public-intake, RPC surface, reporting, Nayax execution, and browser UAT checks are recorded. Complete 2026-05-13.
- The new refund Edge Functions are deployed to the target Supabase project. Complete 2026-05-13:
  - `refund-case-admin-update`
  - `refund-case-automation-sweep`
  - `nayax-card-refund`
  - plus the already required `refund-case-intake` and `nayax-transaction-lookup`
- Post-deploy smoke confirms deployed functions are reachable and guarded. Complete 2026-05-13.
- Live Nayax refund execution remains disabled. Complete 2026-05-13.
- The PR body, this packet, and issue `#409` record that merge is not cutover and not executive UAT readiness. Complete 2026-05-13.

## Shadow-Pilot Gates
Do not enable public intake, ask managers to process real cases, or send sponsor proof review until all of these are true:
- The new refund scope/readiness hardening migration is applied and post-apply dry-run is clean.
- Machine readiness must be configured through Admin > Machines: enable selected refund-intake machines, add up to 3 Machine Managers per machine, and add Nayax machine IDs where card lookup should work.
- Public intake enablement must remain blocked unless the machine is Commercial/Mini, has at least one Machine Manager, has a Nayax machine ID, and has an active location.
- Functional shadow UAT must prove real manager saves, automated customer message logging, tokenized Nayax evidence selection, access boundaries, automation sweep redaction, and reporting write-through with synthetic or approved shadow-mode cases.

## Required Production Secret Names
Set or verify these server-only Supabase secrets by name only; do not paste values into GitHub, docs, chat, screenshots, or logs:
- `PUBLIC_INTAKE_ABUSE_HASH_SALT`
- `NAYAX_LYNX_BASE_URL=https://lynx.nayax.com/operational/v1`
- `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB` or fallback `NAYAX_LYNX_API_TOKEN`
- `NAYAX_REFUND_EXECUTION_ENABLED=false`
- `NAYAX_REFUND_EXECUTION_DRY_RUN=true`
- `NAYAX_REFUND_EXECUTION_KILL_SWITCH=true`
- `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false`
- `NAYAX_REFUND_MAX_AMOUNT_CENTS`
- `NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS`
- `NAYAX_REFUND_DAILY_COUNT_CAP`
- `NAYAX_REFUND_IDEMPOTENCY_SECRET`
- `REFUND_AUTOMATION_SWEEP_SECRET` or fallback `REPORT_SCHEDULER_SECRET`

`NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` stays unset until a later live card-refund execution pilot is explicitly approved.

## Production Order Of Operations
1. Confirm sponsor go/no-go for production shadow-mode setup. Complete 2026-05-13.
2. Set missing server-only secrets. Complete 2026-05-13.
3. Run commerce/refund preflight against production. Complete 2026-05-13.
4. Run production migration dry-run and confirm expected migration list. Complete 2026-05-13.
5. Apply migrations during an approved window. Complete 2026-05-13.
6. Deploy refund Edge Functions. Complete 2026-05-13.
7. Run post-deploy smoke with sanitized output only. Basic reachability complete 2026-05-13.
8. Apply Admin > Machines refund-readiness setup migration. Complete 2026-05-13.
9. Run the read-only pilot readiness audit and generate the local setup packet. Complete 2026-05-13.
10. Fill and dry-run the pilot cohort config template, or configure the same data manually from Admin > Machines.
11. Apply/configure machine readiness data and run functional shadow UAT.
12. Keep Google Form/AppSheet fallback live and begin the selected Commercial/Mini shadow pilot only after functional smoke passes.

## Post-Deploy Smoke
Use sanitized evidence only:
- Public `/refunds/request` loads production-enabled refund machines only.
- Manager can open `/portal/refunds` and update a synthetic or approved shadow case.
- `refund-case-admin-update` logs a customer message row without exposing payment/provider payloads.
- `nayax-card-refund` remains blocked by default flags and records only sanitized attempt metadata.
- Duplicate Google/AppSheet rows remain review-only when they collide with hosted refund cases.

## Do Not Do
- Do not enable live Nayax refund execution.
- Do not cut over QR/direct links broadly.
- Do not disable the Google Form/AppSheet fallback.
- Do not paste secrets, raw Nayax payloads, customer PII, card digits, Zelle details, raw complaint text, or private refund exports into GitHub/docs/chat.
