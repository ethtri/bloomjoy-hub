# Refund Full Automation Go/No-Go Packet

Last updated: 2026-05-13

## Purpose
Use this packet to decide when PR `#432` can move from draft to merge-ready and when production shadow-mode rollout may begin. This is not a cutover approval; Google Form/AppSheet remains the fallback until the shadow pilot is clean.

## Current Status
- PR `#432` is draft by design because production shadow-mode proof still needs real operational data and functional UAT.
- GitHub CI, Vercel, and the GitHub Supabase migration workflow are green for the PR head SHA.
- Local mocked/demo browser UAT passed for public refund intake, thank-you page, Portal > Refunds, and Admin > Machines Machine Manager setup. The latest Admin > Machines harness also proves the setup-capable flow for enabling selected machines on the public refund form, setting an optional customer-facing label, and saving read-only Nayax lookup IDs without enabling live card refunds. This is useful visual evidence, but seeded functional UAT or post-deploy shadow smoke is still required for real saves, automated messages, access boundaries, Nayax lookup, and reporting write-through.
- Production shadow-mode setup was approved and executed on 2026-05-13: refund secrets are present, the approved migration train was applied, and refund Edge Functions were deployed. No live Nayax refund execution was enabled.
- Nayax lookup evidence is tokenized before it reaches the browser. Raw Nayax provider transaction IDs stay server-side and are resolved only by the refund admin Edge Function.
- This branch now includes one additional setup migration for Admin > Machines refund readiness configuration. It has not been applied to production yet; production dry-run shows only `202605130002_admin_machine_refund_readiness_config.sql` pending.
- Production data-readiness smoke currently shows 26 active reporting machines, but 0 refund-intake-enabled machines, 0 Nayax lookup mappings, 0 active Machine Manager assignments, and 0 refund cases. Manager-wide shadow UAT is blocked until machine setup data is added.

## Latest Production Preflight Result
`npm run commerce:preflight -- --project-ref ygbzkgxktzqsiygjlqyg --include-refunds` was refreshed after production secret setup on 2026-05-13 and passed. Remote secret inspection validates presence only; fail-closed values were set during setup and live execution remains disabled.

## Merge-Ready Gates
Move PR `#432` out of draft only after all of these are true:
- Production remote secrets pass `npm run commerce:preflight -- --project-ref ygbzkgxktzqsiygjlqyg --include-refunds`. Complete 2026-05-13.
- `supabase db push --dry-run --linked` shows no pending migrations after the approved apply. Complete 2026-05-13.
- The new refund Edge Functions are deployed to the target Supabase project. Complete 2026-05-13:
  - `refund-case-admin-update`
  - `refund-case-automation-sweep`
  - `nayax-card-refund`
  - plus the already required `refund-case-intake` and `nayax-transaction-lookup`
- Post-deploy smoke confirms deployed functions are reachable and guarded. Complete 2026-05-13.
- Machine readiness must be configured through Admin > Machines after this branch deploys: enable selected refund-intake machines, add up to 3 Machine Managers per machine, and add Nayax machine IDs where card lookup should work.
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
8. Configure machine readiness data from Admin > Machines and run functional shadow UAT.
9. Keep Google Form/AppSheet fallback live and begin manager-wide shadow pilot only after functional smoke passes.

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
