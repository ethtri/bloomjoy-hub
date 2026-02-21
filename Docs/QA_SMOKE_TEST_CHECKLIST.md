# QA Smoke Test Checklist (Sponsor)

Run these checks on localhost for each PR that adds a user-facing feature.

## Global
- [ ] App starts: `npm ci` then `npm run dev`
- [ ] Open the URL printed in the terminal (usually http://localhost:5173)
- [ ] No console errors on home page load
- [ ] Mobile header/nav works (basic)

## Public site
- [ ] Home loads and key CTAs navigate correctly
- [ ] Product pages load (Full, Micro, Mini)
  - [ ] Mini shows “Coming soon / Waitlist” when enabled
- [ ] Sugar page: can start checkout flow (test mode)
- [ ] Cart checkout blocks non-supply items (remove machines before checkout)
- [ ] Plus page: pricing and boundaries are visible and clear
- [ ] Contact/Quote form submits (and confirmation is shown)

## Auth / portal
- [ ] Login flow works (magic link or configured method)
- [ ] Demo note: no real email is sent yet; any email should log in locally
- [ ] Logged-out visit to `/portal` redirects to login
- [ ] Dashboard loads and shows membership status placeholder
- [ ] Non-Plus login can access baseline pages (`/portal`, `/portal/orders`, `/portal/account`)
- [ ] Non-Plus login is blocked from premium pages (`/portal/training`, `/portal/onboarding`, `/portal/support`) with clear Plus messaging
- [ ] Onboarding checklist progress updates when steps are toggled
- [ ] Onboarding progress persists for the same user after page refresh/re-login
- [ ] Training catalog visible to logged-in users
- [ ] Training detail page opens and embed placeholder loads
- [ ] Support request forms submit and show success state

## Payments (test mode)
- [ ] Sugar checkout completes with test card
- [ ] Plus subscription checkout completes with test card
- [ ] Customer Portal link opens (test mode)
- [ ] Account page Manage Billing opens Stripe portal (test mode)
- [ ] Stripe webhook updates subscriptions/orders tables (via Stripe CLI or Dashboard test event)

## Regression sanity
- [ ] `npm run build` passes
- [ ] `npm run lint` passes (if configured)
