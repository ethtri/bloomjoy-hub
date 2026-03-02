# Auth Production Sign-Off (Issue #77)

Purpose: convert deferred auth launch hardening into an execution checklist with clear ownership and evidence capture.

Last updated: 2026-03-01

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
| Supabase email templates updated (signup, magic link, recovery) |  |  |  |
| Google OAuth branding updated (name/logo/support email) |  |  |  |
| Google OAuth consent audience set for launch state |  |  |  |
| Google OAuth redirect URIs include production callback |  |  |  |
| Google OAuth JavaScript origins include production origin |  |  |  |
| Google OAuth callback host resolves to `auth.bloomjoyusa.com` in live flow |  |  |  |
| Google OAuth client secret rotated after setup-sharing activity |  |  |  |
| Supabase Google provider updated with current client credentials |  |  |  |
| Supabase Site URL set to production URL |  |  |  |
| Supabase redirect URL allowlist includes `/login`, `/portal`, `/reset-password`, callback paths |  |  |  |

## 4) Security and reliability checks
### Email OTP and rate limits
- [ ] Auth rate-limit settings reviewed in Supabase dashboard.
- [ ] Support response for 429 incidents documented and shared.
- [ ] Retry/cooldown messaging is confirmed in app UX.

### Password and account recovery
- [ ] Password sign-in succeeds for existing user.
- [ ] Password reset email is delivered and reset flow completes.
- [ ] Temporary/expired link behavior shows actionable error messaging.

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
| Magic link login (`/login` -> email -> `/portal`) |  |  |
| Google login (`/login` -> consent -> `/portal`) |  |  |
| Google callback host is `auth.bloomjoyusa.com` |  |  |
| Logged-out redirect guard (`/portal` -> `/login`) |  |  |
| Branded auth email (signup confirmation) |  |  |
| Branded auth email (magic link) |  |  |
| Branded auth email (password recovery) |  |  |

## 5.1) Evidence package minimum
- [ ] One screenshot of Google consent branding (name/logo/support email).
- [ ] One screenshot of branded auth email template for each flow (signup, magic link, recovery).
- [ ] One network trace or screenshot proving callback host is `auth.bloomjoyusa.com`.
- [ ] Link evidence in section 5 or launch ticket before Go/No-Go.

## 6) Common auth incidents
### 429 rate limit on magic link or OTP
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

## 7) Go/No-Go sign-off
- [ ] All checklist items in sections 3-5 are complete.
- [ ] Evidence links are attached in this file or launch ticket.
- [ ] Release owner has approved launch.

Sign-off:
- Auth technical owner:
- QA owner:
- Release owner:
