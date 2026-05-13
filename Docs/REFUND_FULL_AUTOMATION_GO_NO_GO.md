# Refund Full Automation Go/No-Go Packet

Last updated: 2026-05-13

## Purpose
Use this packet to decide when PR `#432` can move from draft to merge-ready and when production shadow-mode rollout may begin. This is not a cutover approval; Google Form/AppSheet remains the fallback until the shadow pilot is clean.

## Current Status
- PR `#432` is draft by design because production Supabase setup must happen in a controlled order.
- GitHub CI, Vercel, and the GitHub Supabase migration workflow are green for the PR head SHA.
- Local agent/browser UAT passed for public refund intake, thank-you page, Portal > Refunds, and Admin > Machines Machine Manager setup.
- No production migration push, Edge Function deploy, secret mutation, or live Nayax refund execution has been performed for this sprint slice.

## Latest Production Preflight Result
`npm run commerce:preflight -- --project-ref ygbzkgxktzqsiygjlqyg --include-refunds` was refreshed on 2026-05-13. Commerce baseline checks are present, but refund operations remain blocked by these missing production server-only secrets:
- `PUBLIC_INTAKE_ABUSE_HASH_SALT`
- `NAYAX_LYNX_BASE_URL`
- `NAYAX_REFUND_EXECUTION_ENABLED`
- `NAYAX_REFUND_EXECUTION_DRY_RUN`
- `NAYAX_REFUND_EXECUTION_KILL_SWITCH`
- `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED`
- `NAYAX_REFUND_MAX_AMOUNT_CENTS`
- `NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS`
- `NAYAX_REFUND_DAILY_COUNT_CAP`
- `NAYAX_REFUND_IDEMPOTENCY_SECRET`

## Merge-Ready Gates
Move PR `#432` out of draft only after all of these are true:
- Production remote secrets pass `npm run commerce:preflight -- --project-ref ygbzkgxktzqsiygjlqyg --include-refunds`.
- `supabase db push --dry-run --project-ref ygbzkgxktzqsiygjlqyg` shows the expected migration train and no unexpected drift.
- The new refund Edge Functions are deployed to the target Supabase project:
  - `refund-case-admin-update`
  - `refund-case-automation-sweep`
  - `nayax-card-refund`
  - plus the already required `refund-case-intake` and `nayax-transaction-lookup`
- Post-deploy smoke confirms manager refund updates call `refund-case-admin-update` successfully.
- Sponsor gives explicit production rollout go/no-go.

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
1. Confirm sponsor go/no-go for production shadow-mode setup.
2. Set missing server-only secrets.
3. Run commerce/refund preflight against production.
4. Run production migration dry-run and confirm expected migration list.
5. Apply migrations during an approved window.
6. Deploy refund Edge Functions.
7. Run post-deploy smoke with sanitized output only.
8. Keep Google Form/AppSheet fallback live and begin manager-wide shadow pilot only after smoke passes.

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
