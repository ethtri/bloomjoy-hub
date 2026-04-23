# Production Runbook (Go-Live + Rollback)

Purpose: provide a single launch-day procedure for Bloomjoy Hub production release and rollback.

Last updated: 2026-04-06

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
| `VITE_GA4_MEASUREMENT_ID` | Frontend (public, optional) | GA4 page-view tracking | Google Analytics property | Marketing owner |
| `STRIPE_SECRET_KEY` | Server-only | Stripe Edge Functions | Stripe Dashboard > Developers > API keys | Billing owner |
| `STRIPE_SUGAR_MEMBER_PRICE_ID` | Server-only | `stripe-sugar-checkout` | Stripe member sugar price (`$8/kg`) | Billing owner |
| `STRIPE_SUGAR_NON_MEMBER_PRICE_ID` | Server-only | `stripe-sugar-checkout` | Stripe public sugar price (`$10/kg`) | Billing owner |
| `STRIPE_SUGAR_PRICE_ID` | Server-only (legacy bridge only) | `stripe-sugar-checkout` fallback | Legacy member sugar price during rollout | Billing owner |
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
| `SUPABASE_URL` | Server-only | Stripe/order/support Edge Functions | Supabase project URL | Technical owner |
| `SUPABASE_ANON_KEY` | Server-only | `stripe-sugar-checkout`, `stripe-plus-checkout`, `stripe-customer-portal` | Supabase project anon key | Technical owner |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | `stripe-webhook`, `stripe-sugar-checkout`, `lead-submission-intake`, `support-request-intake` | Supabase service role key | Technical owner |

Security rule:
- Never place secrets in `VITE_` variables.
- GA4 measurement IDs are client-safe identifiers, but ad-platform secrets, API keys, or service-role credentials are never client-safe.

## 3) Pre-launch checklist (T-24h)
- [ ] Launch freeze announced (no unrelated merges to `main` during launch window).
- [ ] Branch is synced with latest `main`.
- [ ] Auth launch checklist is prepared and assigned (`Docs/AUTH_PRODUCTION_SIGNOFF.md`).
- [ ] Verification commands pass on launch commit:
  - [ ] `npm ci`
  - [ ] `npm run build`
  - [ ] `npm test --if-present`
  - [ ] `npm run lint --if-present`
- [ ] `npm run commerce:preflight -- --project-ref <project-ref>` passes
- [ ] Supabase production backup/snapshot confirmed before applying new migrations.
- [ ] Stripe products/prices verified (`STRIPE_SUGAR_MEMBER_PRICE_ID`, `STRIPE_SUGAR_NON_MEMBER_PRICE_ID`, `STRIPE_STICKS_PRICE_ID`, `STRIPE_PLUS_PRICE_ID`).
- [ ] Domain and HTTPS confirmed for both production frontend hosts:
  - [ ] `https://www.bloomjoyusa.com`
  - [ ] `https://app.bloomjoyusa.com`

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
supabase secrets set STRIPE_SUGAR_MEMBER_PRICE_ID=...
supabase secrets set STRIPE_SUGAR_NON_MEMBER_PRICE_ID=...
# Optional migration bridge only:
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
supabase secrets set SUPABASE_ANON_KEY=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

Before continuing, run:

```bash
npm run commerce:preflight -- --project-ref <project-ref>
```

WeCom note:
- If token auth succeeds but live sends fail with `60020: not allow to access from your ip`, the remaining issue is WeCom-side network/IP policy, not the secret values. Fix the app/network restriction in WeCom admin, then re-run a live smoke order.

### Step C: Deploy Stripe Edge Functions
Deploy all current checkout/submission functions:

```bash
supabase functions deploy stripe-sugar-checkout --no-verify-jwt
supabase functions deploy stripe-sticks-checkout --no-verify-jwt
supabase functions deploy stripe-plus-checkout --no-verify-jwt
supabase functions deploy stripe-customer-portal --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy lead-submission-intake --no-verify-jwt
supabase functions deploy support-request-intake --no-verify-jwt
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
- Production host expectations:
  - `www.bloomjoyusa.com` serves marketing/storefront routes
  - `app.bloomjoyusa.com` serves operator login, reset-password, portal, and admin routes
  - host redirects are active so `www` forwards app-only paths to `app`, and `app` forwards public routes back to `www`

## 5) Launch verification checklist (T+0)
Run immediately after deploy:
- [ ] Public routes load (`/`, `/machines`, `/supplies`, `/plus`, `/resources`, `/contact`).
- [ ] `https://www.bloomjoyusa.com/login` and `https://www.bloomjoyusa.com/portal` redirect to `https://app.bloomjoyusa.com/...`
- [ ] `https://app.bloomjoyusa.com/` and public marketing paths on `app` redirect back to `https://www.bloomjoyusa.com/...`
- [ ] Login works, password recovery works, and protected routes redirect correctly on `app.bloomjoyusa.com`.
- [ ] Auth launch sign-off checklist is completed with evidence (`Docs/AUTH_PRODUCTION_SIGNOFF.md`).
- [ ] `Docs/QA_SMOKE_TEST_CHECKLIST.md` core payment/auth checks pass.
- [ ] Anonymous/non-member sugar checkout charges `$10/kg` and creates `orders` record in Supabase.
- [ ] Bloomjoy Plus sugar checkout charges `$8/kg` and creates `orders` record in Supabase.
- [ ] Sugar checkout test order stores customer contact, billing/shipping address, pricing tier, receipt URL, and color breakdown in `orders`.
- [ ] Sugar checkout test order sends internal summary email to configured operations recipients.
- [ ] Sugar checkout test order sends customer confirmation email with the branded HTML confirmation layout, order summary, and receipt link.
- [ ] Sugar checkout test order sends WeCom alert when `WECOM_*` secrets are configured and the WeCom app/network policy allows traffic from the live function egress IPs.
- [ ] Bloomjoy branded sticks checkout test order (5+ boxes) creates `orders` record in Supabase with size/address/shipping metadata.
- [ ] Bloomjoy branded sticks checkout test order sends internal summary email to configured operations recipients.
- [ ] Bloomjoy branded sticks checkout test order sends customer confirmation email with the branded HTML confirmation layout.
- [ ] Plus checkout test subscription creates/updates `subscriptions` record in Supabase.
- [ ] Quote request on `/contact` sends internal summary email to configured operations recipients.
- [ ] Quote/order/support events send WeCom alerts to configured internal recipients (or log non-blocking warning on dispatch failure).
- [ ] `/admin/orders` shows address, pricing tier, receipt URL, order breakdown, and notification status for the test orders.
- [ ] WeChat onboarding concierge submit on `/portal/support` creates `support_requests.request_type=wechat_onboarding` with populated `intake_meta`.
- [ ] Stripe customer portal opens from `/portal/account`.
- [ ] No critical frontend console errors on key pages.

## 5b) Incident recovery for missed order sync
Use this when a payment succeeded in Stripe but the order is missing in `public.orders`.

Preferred order of operations:
1) Repair and deploy the webhook.
2) Replay the Stripe event to the repaired webhook.
3) If replay is unavailable or insufficient, import the order snapshot manually:
   - `npm run orders:backfill -- --session-id <cs_...> --dry-run`
   - `npm run orders:backfill -- --session-id <cs_...>`
4) Verify the imported order appears in `/admin/orders` with:
   - customer email and phone
   - billing and shipping address
   - pricing tier and unit price
   - sugar color breakdown or Bloomjoy branded stick order details
   - notification status fields

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
