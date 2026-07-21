# Auth Production Sign-Off (Issue #77)

Purpose: convert deferred auth launch hardening into an execution checklist with clear ownership and evidence capture.

Last updated: 2026-05-04

## 1) Owners and launch window
- Launch date/time:
- Release owner:
- Auth technical owner:
- QA owner:

## 2) Preconditions
- [ ] Production frontend URL is final and HTTPS-enabled.
- [ ] Supabase production project and Google Cloud project access confirmed.
- [ ] SMTP provider account for Bloomjoy sender domain is ready.
- [ ] DNS access is available for SPF/DKIM/DMARC updates.

## 3) Configuration checklist (with evidence)
Record who completed each item and where proof is stored (screenshot, config export, or ticket link).
Status values: `Not started`, `In progress`, `Done`, `Blocked`.

| Item | Owner | Status | Evidence |
|---|---|---|---|
| Supabase custom SMTP configured (sender + host + auth) |  |  |  |
| SPF record published for sender domain |  |  |  |
| DKIM record published and verified |  |  |  |
| DMARC policy published |  |  |  |
| Scanner-resistant Supabase templates published (invite, Email Code, recovery); repository validator passes |  |  |  |
| Google OAuth branding updated (name/logo/support email) |  |  |  |
| Google OAuth consent audience set for launch state |  |  |  |
| Google OAuth redirect URIs include production callback |  |  |  |
| Google OAuth JavaScript origins include production origin |  |  |  |
| Google OAuth callback host resolves to `auth.bloomjoyusa.com` in live flow |  |  |  |
| Google OAuth client secret rotated after setup-sharing activity |  |  |  |
| Supabase Google provider updated with current client credentials |  |  |  |
| Supabase Site URL set to `https://app.bloomjoyusa.com` |  |  |  |
| Supabase redirect URL allowlist includes `https://app.bloomjoyusa.com` app routes plus `https://*-snapcase.vercel.app/**` for Vercel preview UAT |  |  |  |

## 4) Security and reliability checks
### Email OTP and rate limits
- [ ] Auth rate-limit settings reviewed in Supabase dashboard.
- [ ] Support response for 429 incidents documented and shared.
- [ ] Retry/cooldown messaging is confirmed in app UX.

### Password and account recovery
- [ ] Password sign-in succeeds for existing user.
- [ ] Password recovery code is delivered and reset flow completes.
- [ ] Invalid, expired, consumed, and superseded code behavior shows actionable recovery messaging.

### Coordinated Email Code cutover (`#609`)
- [ ] Pause production auth-email sends and access-invite resends for the short cutover window; do not leave the new templates paired with the old UI or the new UI paired with the old token-link templates.
- [ ] Deploy the frontend and `access-invite` copy, then immediately run the guarded hosted-template publication command with matching `--project-ref` and `--confirm-project-ref` values.
- [ ] Confirm the publication helper read-back verifies all invite, Email Code, and recovery subjects and bodies.
- [ ] Resend from Hub Access after both sides are active and tell the recipient to use only the newest Bloomjoy messages; do not rely on a pre-cutover one-click token.
- [ ] Complete masked live-inbox prefetch, code entry, password creation, and portal-access UAT before closing `#609` or declaring the incident fixed.

### Session behavior (desktop + mobile)
- [ ] New login persists across page refresh.
- [ ] Opening a new tab keeps user authenticated.
- [ ] Manual logout clears session and blocks protected routes.
- [ ] Session behavior validated on desktop + at least one mobile browser.

## 5) Production auth smoke evidence
Capture evidence links for each required flow.

| Flow | Result | Evidence |
|---|---|---|
| Password login (`/login` -> `/portal`) |  |  |
| Email Code login (`/login` -> email -> `/portal`) |  |  |
| Google login (`/login` -> consent -> `/portal`) |  |  |
| Vercel preview login returns to the same preview host at `/portal` |  |  |
| Google callback host is `auth.bloomjoyusa.com` |  |  |
| Logged-out redirect guard (`/portal` -> `/login`) |  |  |
| Branded auth email (signup confirmation) |  |  |
| Branded auth email (Email Code) |  |  |
| Branded auth email (password recovery) |  |  |

## 5.1) Evidence package minimum
- [ ] One screenshot of Google consent branding (name/logo/support email).
- [ ] One screenshot of each scanner-resistant branded auth email template (invite, Email Code, recovery), showing the manual code and stable non-verifying button.
- [ ] One network trace or screenshot proving callback host is `auth.bloomjoyusa.com`.
- [ ] Link evidence in section 5 or launch ticket before Go/No-Go.

## 5.2) Session closeout automation snapshot (2026-03-09)
Automated API smoke checks were run against production config values:
- `lead-submission-intake` quote submit returned `200 {"ok":true}`.
- Matching `lead_submissions` row was created with non-null `internal_notification_sent_at`.
- Matching `internal_notification_dispatches` row was created with non-null `sent_at`.
- `auth.signInWithOtp(...)` returned success (`SMOKE_MAGIC_LINK_STATUS=OK`).
- `auth.resetPasswordForEmail(...)` returned success (`SMOKE_RESET_STATUS=OK`).

Manual evidence still required before go/no-go:
- Inbox-level confirmation and screenshots for scanner-resistant invite, Email Code, and recovery templates.
- Google OAuth consent/callback-host screenshot evidence from full browser flow.

## 6) Common auth incidents
### 429 rate limit on Email Code or OTP
- Confirm repeated attempts were the trigger.
- Ask user to wait for cooldown window and retry once.
- If broad impact is observed, check Supabase auth logs and rate-limit settings before changing policy.

### Google `redirect_uri_mismatch`
- Verify Google OAuth redirect URI exactly matches Supabase callback URI.
- Confirm production callback is present in Google OAuth client settings.
- Confirm Supabase Google provider uses the intended client ID/secret.

### `unauthorized_domain`
- Add/verify domain ownership in Google OAuth branding configuration.
- Confirm production origin is in authorized JavaScript origins.

### Redirect lands on `http://localhost:3000/#access_token=...`
- Treat this as a stale Supabase URL Configuration issue first.
- Confirm Supabase Site URL is `https://app.bloomjoyusa.com`.
- Confirm redirect allowlist includes `https://app.bloomjoyusa.com`, `/login`, `/portal`, and `/reset-password`.

### Vercel preview login returns to production
- Treat this as a missing Supabase preview redirect allowlist entry first.
- Confirm Supabase Site URL remains `https://app.bloomjoyusa.com`.
- Confirm Additional Redirect URLs include `https://*-snapcase.vercel.app/**`.
- Retry from the PR preview `/login` URL and confirm the final URL stays on the same preview host at `/portal`.

## 7) Go/No-Go sign-off
- [ ] All checklist items in sections 3-5 are complete.
- [ ] Evidence links are attached in this file or launch ticket.
- [ ] Release owner has approved launch.

Sign-off:
- Auth technical owner:
- QA owner:
- Release owner:
