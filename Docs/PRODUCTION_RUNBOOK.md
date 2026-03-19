# Production Runbook (Go-Live + Rollback)

Purpose: provide a single launch-day procedure for Bloomjoy Hub production release and rollback.

Last updated: 2026-03-10

## 1) Roles and ownership
- Release owner: coordinates launch window and final go/no-go call.
- Technical owner: executes frontend + Supabase deploy steps.
- Billing owner: verifies Stripe products/prices/webhook health.
- Auth owner: executes auth provider, redirect, and branded email configuration.
- QA owner: runs smoke checklist and signs off.

## 2) Production configuration matrix
Set the following values before launch.

| Variable | Scope | Used by | Source of truth | Owner |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Frontend (public) | SPA Supabase client | Supabase project settings | Technical owner |
| `VITE_SUPABASE_ANON_KEY` | Frontend (public) | SPA Supabase client | Supabase project API keys | Technical owner |
| `STRIPE_SECRET_KEY` | Server-only | Stripe Edge Functions | Stripe Dashboard > Developers > API keys | Billing owner |
| `STRIPE_SUGAR_PRICE_ID` | Server-only | `stripe-sugar-checkout` | Stripe product/price config | Billing owner |
| `STRIPE_STICKS_PRICE_ID` | Server-only | `stripe-sticks-checkout` | Stripe product/price config | Billing owner |
| `STRIPE_PLUS_PRICE_ID` | Server-only | `stripe-plus-checkout` | Stripe product/price config | Billing owner |
| `STRIPE_WEBHOOK_SECRET` | Server-only | `stripe-webhook` | Stripe webhook endpoint signing secret | Billing owner |
| `RESEND_API_KEY` | Server-only | `stripe-webhook`, `lead-submission-intake` | Resend API key | Technical owner |
| `INTERNAL_NOTIFICATION_FROM_EMAIL` | Server-only | `stripe-webhook`, `lead-submission-intake` | Verified sender in Resend | Technical owner |
| `INTERNAL_NOTIFICATION_RECIPIENTS` | Server-only | `stripe-webhook`, `lead-submission-intake` | Internal recipient list (comma-separated) | Release owner |
| `WECOM_CORP_ID` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom app settings | Technical owner |
| `WECOM_AGENT_ID` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom app settings | Technical owner |
| `WECOM_AGENT_SECRET` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom app settings | Technical owner |
| `WECOM_ALERT_TO_USERIDS` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom recipient user IDs (comma-separated) | Release owner |
| `SUPABASE_URL` | Server-only | `stripe-webhook`, `lead-submission-intake`, `support-request-intake` | Supabase project URL | Technical owner |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | `stripe-webhook`, `lead-submission-intake`, `support-request-intake` | Supabase service role key | Technical owner |

Security rule:
- Never place secrets in `VITE_` variables.

## 3) Pre-launch checklist (T-24h)
- [ ] Launch freeze announced (no unrelated merges to `main` during launch window).
- [ ] Branch is synced with latest `main`.
- [ ] Auth launch checklist is prepared and assigned (`Docs/AUTH_PRODUCTION_SIGNOFF.md`).
- [ ] Verification commands pass on launch commit:
  - [ ] `npm ci`
  - [ ] `npm run build`
  - [ ] `npm test --if-present`
  - [ ] `npm run lint --if-present`
- [ ] Supabase production backup/snapshot confirmed before applying new migrations.
- [ ] Stripe products/prices verified (`STRIPE_SUGAR_PRICE_ID`, `STRIPE_STICKS_PRICE_ID`, `STRIPE_PLUS_PRICE_ID`).
- [ ] Domain and HTTPS for frontend production URL confirmed.

## 4) Deploy sequence (launch day)
Use this order exactly.

### Step A: Deploy database migrations
Apply all `supabase/migrations/*.sql` not already applied, oldest to newest.

Recommended:
1) Link Supabase project:
   - `supabase link --project-ref <project-ref>`
2) Push migrations:
   - `supabase db push`

### Step B: Set/refresh Edge Function secrets
Run once per environment or when values rotate:

```bash
supabase secrets set STRIPE_SECRET_KEY=...
supabase secrets set STRIPE_SUGAR_PRICE_ID=...
supabase secrets set STRIPE_STICKS_PRICE_ID=...
supabase secrets set STRIPE_PLUS_PRICE_ID=...
supabase secrets set STRIPE_WEBHOOK_SECRET=...
supabase secrets set RESEND_API_KEY=...
supabase secrets set INTERNAL_NOTIFICATION_FROM_EMAIL=...
supabase secrets set INTERNAL_NOTIFICATION_RECIPIENTS=etrifari@bloomjoysweets.com,ian@bloomjoysweets.com
supabase secrets set WECOM_CORP_ID=...
supabase secrets set WECOM_AGENT_ID=...
supabase secrets set WECOM_AGENT_SECRET=...
supabase secrets set WECOM_ALERT_TO_USERIDS=ethan.trifari,ops.manager
supabase secrets set SUPABASE_URL=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

### Step C: Deploy Stripe Edge Functions
Deploy all current checkout/submission functions:

```bash
supabase functions deploy stripe-sugar-checkout
supabase functions deploy stripe-sticks-checkout
supabase functions deploy stripe-plus-checkout
supabase functions deploy stripe-customer-portal
supabase functions deploy stripe-webhook
supabase functions deploy lead-submission-intake
supabase functions deploy support-request-intake
```

### Step D: Configure Stripe webhook endpoint
Stripe endpoint URL:
- `https://<project-ref>.functions.supabase.co/stripe-webhook`

Required events:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

After endpoint creation/update, copy new signing secret to `STRIPE_WEBHOOK_SECRET`.

### Step E: Deploy frontend SPA
Deploy current launch commit to your chosen host (Vercel/Netlify/etc.) with:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 5) Launch verification checklist (T+0)
Run immediately after deploy:
- [ ] Public routes load (`/`, `/machines`, `/supplies`, `/plus`, `/resources`, `/contact`).
- [ ] Login works, password recovery works, and protected routes redirect correctly.
- [ ] Auth launch sign-off checklist is completed with evidence (`Docs/AUTH_PRODUCTION_SIGNOFF.md`).
- [ ] `Docs/QA_SMOKE_TEST_CHECKLIST.md` core payment/auth checks pass.
- [ ] Sugar checkout test order creates `orders` record in Supabase.
- [ ] Sugar checkout test order sends internal summary email to configured operations recipients.
- [ ] Blank sticks checkout test order (5+ boxes) creates `orders` record in Supabase with size/address/shipping metadata.
- [ ] Blank sticks checkout test order sends internal summary email to configured operations recipients.
- [ ] Plus checkout test subscription creates/updates `subscriptions` record in Supabase.
- [ ] Quote request on `/contact` sends internal summary email to configured operations recipients.
- [ ] Quote/order/support events send WeCom alerts to configured internal recipients (or log non-blocking warning on dispatch failure).
- [ ] WeChat onboarding concierge submit on `/portal/support` creates `support_requests.request_type=wechat_onboarding` with populated `intake_meta`.
- [ ] Stripe customer portal opens from `/portal/account`.
- [ ] No critical frontend console errors on key pages.

## 6) Rollback checklist
Trigger rollback if critical checkout/auth/data sync regressions are found.

Immediate actions:
- [ ] Declare rollback and pause new release changes.
- [ ] Temporarily disable promotion/checkout CTAs if needed.

Rollback order:
1) Frontend:
   - Re-deploy previous known-good frontend release.
2) Edge Functions:
   - Re-deploy previous known-good function versions for:
     - `stripe-sugar-checkout`
     - `stripe-sticks-checkout`
     - `stripe-plus-checkout`
     - `stripe-customer-portal`
     - `stripe-webhook`
     - `support-request-intake`
3) Secrets:
   - Restore prior secrets only if rotation caused failure.
4) Database:
   - Do not run destructive rollback SQL during incident response.
   - If a migration caused breakage, recover via pre-launch backup/snapshot and controlled restore.

Post-rollback:
- [ ] Confirm site/checkout baseline health.
- [ ] Log incident summary and root cause.
- [ ] Create follow-up issue before reattempting launch.

## 7) Dry-run record (staging-like rehearsal)
Date: 2026-02-23
- Scope rehearsed: full command/checklist walkthrough for migration, function deploy, webhook wiring, frontend deploy, and rollback path.
- Verification baseline: local release commands pass (`npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`).
- Outcome: runbook validated for launch use; production credential execution remains owner-controlled.
