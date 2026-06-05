# Partner Technician Access UAT

Use this runbook before partner handoff for Merlin/Bubble Planet-style portfolios.

## Agent UAT Command

Start the app from the task worktree:

```bash
npm run dev:uat
```

Then run the mocked browser UAT:

```bash
npm run partner-technicians:validate-uat -- --app-url http://127.0.0.1:8081
```

The script uses mocked Supabase Auth, REST, RPC, and Edge Function responses. It does not send email and does not write to Supabase. Screenshots are written under `output/playwright`.

## Agent UAT Coverage

- Corporate Partner manager reaches `/portal/account`.
- Partner scope is visible as a partner portfolio, not global reporting access.
- Partner creates a Technician assigned to an in-scope machine.
- New Technician saves automatically call `access-invite` with `inviteType=technician`.
- Invite delivery status appears in the Technician row.
- Partner creates a second Technician assigned to the same machine.
- Partner creates a training-only Technician.
- Out-of-scope machine assignment is denied in the UAT route guard.
- Partner revokes a Technician and the row leaves the active list.
- Technician signs in, entitlement resolution runs, and `/portal/training` is available.
- Technician opens `/portal/reports` and sees only the assigned machine.
- Technician does not see partner dashboard controls.

## Human UAT Packet

Use staging or a Vercel preview with non-sensitive test records.

Personas:

- Corporate Partner manager: active corporate partner membership and at least one active portal-enabled partnership party.
- Assigned-machine Technician: invited email with one assigned machine.
- Training-only Technician: invited email with no assigned machine.
- Revoked Technician: previously invited email after revoke.

Checklist:

- [ ] Partner manager opens `/portal/account` and sees Technician Access.
- [ ] Partner account selector only lists current partner portfolio accounts.
- [ ] Partner can add two Technicians to the same machine, and each save sends an invite attempt.
- [ ] Partner can add a training-only Technician, and save sends an invite attempt.
- [ ] Partner can resend the Technician invite from the row after the first send.
- [ ] Invite email explains training access and assigned-machine reporting when applicable.
- [ ] Invite email does not imply broad partner reporting.
- [ ] Copy login link points to `/login?intent=technician&email=...`.
- [ ] Assigned-machine Technician signs in with the same email and reaches `/portal/training`.
- [ ] Assigned-machine Technician reaches `/portal/reports` for only the assigned machine.
- [ ] Training-only Technician reaches `/portal/training` and does not receive machine reporting.
- [ ] Technician users do not see partner dashboard controls.
- [ ] Revoking a Technician removes Technician-sourced training/reporting after refresh or sign-out/sign-in.

## Live Environment Notes

Functional invite email tests require:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` on the Edge Function runtime
- `RESEND_API_KEY`
- `INTERNAL_NOTIFICATION_FROM_EMAIL`
- optional preview allowlist secret if sending preview login links

For real rollout signoff, record the states separately: grant saved, `access-invite` attempted, provider accepted/delivered or failed, recipient inbox received, and recipient activated access with the invited email. Keep recipient emails masked in issue/PR comments.

Never commit credentials or test-user passwords. Record test emails, source grant IDs, and cleanup status in the PR or local UAT notes only.
