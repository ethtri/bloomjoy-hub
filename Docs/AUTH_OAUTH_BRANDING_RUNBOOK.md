# Google OAuth Branding + Custom Auth Domain Runbook

Purpose: make Google sign-in show Bloomjoy branding and move OAuth callbacks off `<project-ref>.supabase.co` to a Bloomjoy-owned auth subdomain.

Last updated: 2026-03-01

## 1) Prerequisites
- Domain access for Bloomjoy DNS (to create CNAME/TXT records).
- Supabase project Admin/Owner access.
- Google Cloud project access for OAuth consent + OAuth 2.0 client settings.
- Supabase custom domain add-on enabled (required by Supabase to use custom auth hostname).
- App URLs decided in advance:
  - Local app URL: `http://localhost:8080` (or your active Vite port)
  - Production app URL (example): `https://hub.bloomjoysweets.com`
  - Auth hostname target (recommended): `auth.bloomjoysweets.com`

## 1.1) Execution tracker (issue #78)
Record status as `Not started`, `In progress`, `Done`, or `Blocked`.

| Environment | Goal | Status | Evidence |
|---|---|---|---|
| Localhost (`http://localhost:8080`) | Google sign-in completes and returns to `/portal` | In progress |  |
| Staging (if used) | Consent screen branding + callback host verified |  |  |
| Production | Callback host on custom domain + branding approved |  |  |

## 2) Collect values before changing anything
- `PROJECT_REF` (Supabase project ref).
- Current Supabase Auth callback URL:
  - `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
- Planned custom-domain callback URL:
  - `https://auth.bloomjoysweets.com/auth/v1/callback`
- Redirect URLs used by app flows:
  - `http://localhost:8080/portal`
  - `http://localhost:8080/reset-password`
  - `https://hub.bloomjoysweets.com/portal` (example)
  - `https://hub.bloomjoysweets.com/reset-password` (example)

Current project snapshot (2026-03-01):
- Bloomjoy Hub project ref: `ygbzkgxktzqsiygjlqyg`
- Current blocker: Supabase Custom Domain add-on is not enabled yet, so domain commands fail until billing/add-on enablement is complete.

## 2.1) Copy/paste setup values (Bloomjoy)
Use these exact values when configuring Google OAuth + Supabase auth settings:

- Google OAuth Authorized JavaScript origins:
  - `http://localhost:8080`
  - `https://hub.bloomjoysweets.com`
- Google OAuth Authorized redirect URIs:
  - `https://ygbzkgxktzqsiygjlqyg.supabase.co/auth/v1/callback` (temporary during cutover)
  - `https://auth.bloomjoysweets.com/auth/v1/callback` (target)
- Supabase Auth URL configuration:
  - Site URL: `https://hub.bloomjoysweets.com`
  - Additional redirects:
    - `http://localhost:8080`
    - `http://localhost:8080/login`
    - `http://localhost:8080/portal`
    - `http://localhost:8080/reset-password`
    - `https://hub.bloomjoysweets.com`
    - `https://hub.bloomjoysweets.com/login`
    - `https://hub.bloomjoysweets.com/portal`
    - `https://hub.bloomjoysweets.com/reset-password`

Optional preflight helper (repo command):

```bash
npm run auth:preflight
```

For post-cutover enforcement (must use custom auth host):

```bash
npm run auth:preflight -- --require-custom-auth-domain
```

## 3) Configure Supabase custom auth domain
You can do this in Dashboard or CLI. CLI example:

```bash
supabase domains create --project-ref <PROJECT_REF> --custom-hostname auth.bloomjoysweets.com
```

Bloomjoy copy/paste command (after add-on is enabled):

```bash
supabase domains create --project-ref ygbzkgxktzqsiygjlqyg --custom-hostname auth.bloomjoysweets.com
```

Then add DNS records exactly as Supabase returns:
- `CNAME auth.bloomjoysweets.com -> <PROJECT_REF>.supabase.co`
- `_acme-challenge` TXT record for certificate verification

After DNS propagates, re-verify and activate:

```bash
supabase domains reverify --project-ref <PROJECT_REF> --custom-hostname auth.bloomjoysweets.com
supabase domains activate --project-ref <PROJECT_REF> --custom-hostname auth.bloomjoysweets.com
```

Important:
- Keep old and new callback hosts allowed during cutover to avoid sign-in downtime.
- Existing links to `<PROJECT_REF>.supabase.co` continue to work until you remove them.

## 4) Configure Google OAuth consent branding
Google Cloud Console -> Google Auth Platform:

1) Branding
- Set app name to Bloomjoy Hub branding.
- Upload logo.
- Set support email and developer contact email.
- Add authorized domain(s) used by app/auth hosts (for example `bloomjoysweets.com`).

2) Audience
- If still in testing, keep a controlled test-user list.
- Move to production only when branding/review are complete.

3) Data access / scopes
- Keep required scopes for Supabase Google sign-in:
  - `openid`
  - `.../auth/userinfo.email`
  - `.../auth/userinfo.profile`

## 5) Configure Google OAuth client IDs
Google Cloud Console -> Credentials -> OAuth 2.0 Client IDs:

1) Authorized JavaScript origins:
- `http://localhost:8080`
- Production app origin (example): `https://hub.bloomjoysweets.com`

2) Authorized redirect URIs:
- `https://<PROJECT_REF>.supabase.co/auth/v1/callback` (temporary during cutover)
- `https://auth.bloomjoysweets.com/auth/v1/callback` (post-cutover target)

## 6) Configure Supabase Auth URLs + provider settings
Supabase Dashboard -> Authentication:

1) URL Configuration
- Site URL:
  - local dev: `http://localhost:8080`
  - production: `https://hub.bloomjoysweets.com` (example)
- Additional redirect URLs include:
  - `http://localhost:8080`
  - `http://localhost:8080/login`
  - `http://localhost:8080/portal`
  - `http://localhost:8080/reset-password`
  - `https://hub.bloomjoysweets.com`
  - `https://hub.bloomjoysweets.com/login`
  - `https://hub.bloomjoysweets.com/portal`
  - `https://hub.bloomjoysweets.com/reset-password`

2) Google Provider
- Paste Google client ID and client secret from the Google project.
- Save provider configuration.

## 7) Repo/env updates
- Set frontend env to custom auth host after activation:
  - `VITE_SUPABASE_URL=https://auth.bloomjoysweets.com`
- Keep `VITE_SUPABASE_ANON_KEY` unchanged for the same Supabase project.
- Do not commit production secrets or local `.env` files.

Repo auth redirect behavior:
- Login and Google auth redirects use `window.location.origin` and route to `/portal`.
- Password recovery redirects use `window.location.origin` and route to `/reset-password`.

## 8) Verification checklist
- Localhost:
  - [ ] Open `/login` and start Google sign-in.
  - [ ] Consent screen shows Bloomjoy app name/logo/support email.
  - [ ] OAuth callback returns to `/portal` and session is created.
- Deployed environment:
  - [ ] Repeat verification on staging or production app domain.
  - [ ] Browser network trace shows callback host `auth.bloomjoysweets.com` (not `<PROJECT_REF>.supabase.co`).
  - [ ] No auth-console errors during sign-in.
  - [ ] Record screenshot/evidence links in `Docs/AUTH_PRODUCTION_SIGNOFF.md`.

## 9) Troubleshooting
### `redirect_uri_mismatch`
- Cause: callback URI in Google client does not exactly match the URI Supabase sends.
- Fix:
  - Ensure exact match (scheme, host, path, trailing slash).
  - Keep both old and new callback URIs during cutover.
  - Confirm Supabase provider is using the intended client ID.

### `unauthorized_domain`
- Cause: domain not listed as authorized for OAuth consent/project.
- Fix:
  - Add top private domain (for example `bloomjoysweets.com`) in Google Auth Platform branding.
  - Complete domain verification in Google Search Console if prompted.

### `invalid_request` or "invalid response from provider"
- Cause: inconsistent OAuth client setup, missing provider secret, or redirect URL not allowlisted.
- Fix:
  - Re-check Google client ID/secret in Supabase provider config.
  - Re-check Supabase URL Configuration allowlist and Site URL.
  - Confirm app origin and callback URI entries match current environment.

## 10) Launch hardening follow-up
Anything still pending for production approval/review stays tracked in issue `#77`:
- SMTP/email branding + DNS sender auth records
- OAuth consent publish/review timing
- Secret rotation after setup/testing screenshots
- Production smoke evidence capture

## 10.1) Board status guidance
- Keep issue `#78` in `In Progress` while custom domain cutover and verification are incomplete.
- Move issue `#78` to `Done` only after section 8 checks pass in localhost and deployed environment.
- Keep issue `#77` open until production auth sign-off evidence is fully captured.

## 11) References (official docs)
- Supabase Auth + Google provider setup:
  - https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase custom domains:
  - https://supabase.com/docs/guides/platform/custom-domains
- Supabase redirect URL allow list behavior:
  - https://supabase.com/docs/guides/auth/redirect-urls
- Google OAuth web-server flow (`redirect_uri_mismatch` guidance):
  - https://developers.google.com/identity/protocols/oauth2/web-server
- Google OAuth app branding and domain verification:
  - https://support.google.com/cloud/answer/13464321
