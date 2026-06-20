# Partner Technician Access CX Audit

Scope: `/portal/account` Technician Access, Technician invite delivery/acceptance, `/portal/training`, and `/portal/reports` for assigned-machine Technicians.

## Audit Health Score

| Dimension | Score | Finding |
| --- | ---: | --- |
| Accessibility | 3/4 | Controls use labels, buttons, focusable primitives, and 44px target height. Live browser UAT still needs a full keyboard-only pass on staging. |
| Performance | 3/4 | Data fetches are scoped and cached. Machine search is local and only appears for larger portfolios. |
| Responsive Design | 3/4 | Panel and rows collapse to single-column mobile layouts. Agent screenshots cover desktop and narrow mobile. |
| Theming | 3/4 | Uses existing shadcn/Tailwind tokens and portal card patterns. Email HTML uses established inline invite styling. |
| Anti-patterns | 4/4 | No decorative dashboard tropes, nested cards, gradient text, or marketing composition in the operational surface. |
| Total | 16/20 | Good. Ready for agent UAT and human staging UAT after live env credentials are available. |

## What Improved

- Partner scope is explicit: the panel now identifies partner portfolio scope and says management is limited to the machines shown.
- Copy now makes the access model clear: training library plus optional assigned-machine reporting.
- Same-machine, multiple-Technician behavior is explicit in the picker copy and covered by agent UAT.
- Invite state is visible on each Technician row: no invite sent, ready to invite, invite sent, or invite failed.
- Partner admins have clear recovery actions: send/resend invite and copy login link.
- Large portfolios get a local machine search and can assign one Technician to multiple in-scope machines without broadening the Technician persona.

## Priority Findings

### P1: Live invite email delivery must be verified on staging

Impact: Mocked agent UAT proves UI and request shape, but only staging can prove Resend delivery, Edge Function secrets, and sender-domain configuration.

Resolution path: Use the live checklist in `Docs/PARTNER_TECHNICIAN_ACCESS_UAT.md` before partner handoff.

### P1: RLS and Edge Function authorization are high-risk

Impact: The flow touches service-role Edge Function code and invite delivery evidence. A regression could leak invite status or permit out-of-scope sends.

Resolution path: The migration adds `can_send_technician_access_invite` and a Technician-only delivery-history policy. PR verification must include migration/RPC validation and negative UAT evidence.

### P2: Human UAT should review terminology

Impact: "Technician" is acceptable per product direction, but partner staff may use "operator" conversationally.

Resolution path: Keep the UI label as Technician. During human UAT, ask whether the invite email body should mention "operator staff" once in supporting copy.

## Persona Checks

Corporate Partner manager:

- Can see which partner/account scope is active.
- Can add, invite, edit, and revoke from one surface.
- Can understand that each Technician is scoped, not a broad reporting user.

Assigned-machine Technician:

- Receives invite language that says training plus assigned-machine reporting.
- Sign-in path carries `intent=technician` and same-email guidance.
- Reporting route should show only assigned machines.

Training-only Technician:

- Receives invite language that says training library only.
- Should not see reporting routes unless later assigned a machine.

Support/Admin:

- Invite attempts are recorded in `access_invite_deliveries` and `admin_audit_log`.
- Failed delivery state is visible to the partner row and auditable by admins.

## Remaining UAT Evidence Needed

- Staging send/resend email delivery with real Resend secrets.
- Same-email signup/sign-in after clicking the email.
- Revocation after a real session refresh or sign-out/sign-in.
- Keyboard-only pass on `/portal/account` for account selection, machine picker, row actions, and revoke dialog.
