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
- [ ] Sugar page supports one-click equal split across white/blue/orange/red and allows custom per-color override
- [ ] Sugar page handles high-volume setup (e.g., 500KG+) without repetitive click controls
- [ ] Cart checkout blocks non-sugar items
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
- [ ] Sugar checkout completes with test card for high-quantity equal split (e.g., 500KG total)
- [ ] Sugar checkout completes with test card for unequal split mix (custom per-color quantities)
- [ ] Plus subscription checkout computes expected monthly amount from selected machine count (e.g., 1x=$100, 3x=$300) and completes with test card
- [ ] Customer Portal link opens (test mode)
- [ ] Account page Manage Billing opens Stripe portal (test mode)
- [ ] Stripe webhook updates subscriptions/orders tables (via Stripe CLI or Dashboard test event)

## Regression sanity
- [ ] `npm run build` passes
- [ ] `npm run lint` passes (if configured)

