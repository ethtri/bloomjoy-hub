# Email alert subscriptions: MVP UI proposal

Implementation update: [#1715](https://github.com/ethtri/bloomjoy-hub/issues/1715)
supersedes the defaults in this historical prototype. The owner requested daily
digests on for managers and technicians, with every other approved alert off by
default, including the manager-only decision-ready opt-in. Unsaved daily defaults
follow current and future authorized assignments; explicit preferences persist.

Continuation of [issue #1711](https://github.com/ethtri/bloomjoy-hub/issues/1711) and [draft PR #1712](https://github.com/ethtri/bloomjoy-hub/pull/1712). The owner accepted six email concepts and requested the subscription UI. This is a local interactive design artifact using fictional accounts and machines. It does not add production routes, save live subscriptions or send email.

Open [the prototype](subscriptions.html). Use the outer review controls to switch between a Manager with four machines and a Technician with reporting access to two machines, try first-time setup, and demonstrate no machine access or a failed save. A reload resets the sample. All screens share a saved snapshot and a separate editing draft for this tab.

## Placement

The proposed canonical home is **Settings → Email alerts**, at a future `/portal/notifications` route. Both the shared profile menu and Account preferences link to it. This page needs its own eligible-user access guard: some training-tier technicians have reporting access while Account Settings is hidden or unavailable. Do not inherit the Account or Admin Machines guard merely because the UI is a personal setting.

| Entry point | Behavior |
| --- | --- |
| Shared profile menu / Settings navigation | Open the same personal Email alerts page, including from Admin. |
| Account → Email alerts | Shortcut for users who can access Account. |
| Machine detail → Email alerts | Open a panel for that exact machine. Include on reporting machine detail, and authorized Admin machine detail where appropriate. |
| Reports → Subscribe to digest | Carry the current explicit machine filter into a draft. Let the user select daily, weekly or both and review before saving. Historical report dates do not become a recurring fixed window. |
| Email footer → Manage alerts | Production implementation should open the same preferences, focused on the relevant category. Optional unsubscribe must remain separate from automatic manager notices. Existing email-gallery footer controls still belong to the earlier sketch. |

The prototype intentionally shows only relevant shell destinations; it is not a redesign of Hub navigation or a proposal to remove other destinations.

## Shared preference model

- Each optional category has its own machine set and enabled state. Daily and weekly are independent; they can have different machines and delivery times.
- The five optional categories retain IDs 01, 02, 03, 07 and 08. **04 Refund decision ready** appears separately as automatic for assigned managers, without an opt-out control.
- Existing automatic daily open-refund messages also remain separate. They cover every canonically open assigned-machine case, including older or unchanged work, at their existing schedule. Optional choices cannot narrow them. Combine with an operations digest only where scope and timing preserve that contract.
- Central editing uses checkboxes plus explicit Save. Counts and inbox summaries reflect the draft, with a visible unsaved state. Cancel restores saved choices. Navigation warns before discarding a draft.
- The machine panel adds or removes only the current machine. Saving preserves all other active scopes. Removing the last machine turns the category off. Adding a machine to an inactive category cannot revive old scopes.
- Bulk selection means all **current** eligible machines. New assignments are not automatically enrolled. Production recipient projection must recheck access at delivery and link open.
- The email address is the account email, read-only here. No arbitrary recipients, CC, enrollment of coworkers or new team-management controls.
- Manager and Technician scenarios illustrate different grants. The technician example has reporting access and a proposed authorized operational refund excerpt. A subscription does not grant either capability, customer case access or manager decision authority.

## First-time setup

1. **Choose updates.** Optional suggestions use the current role. Manager suggests daily, weekly and quiet-sales; Technician suggests new-request and offline. Choose myself clears suggestions. No enrollment yet.
2. **Choose machines.** Explicit common starting scope for the chosen categories. This is clearly labeled; future machines are excluded.
3. **Review and save.** Delivery address, timezone, per-alert cadence, and named machine scope. Each category's machines remain editable here. Back preserves choices. A confirmation summarizes the saved preview.

The Reports shortcut uses the same flow and existing subscription model, so it does not create a second subscription object. It preserves non-digest subscriptions. Daily/weekly choices shown in the draft are explicit; saving updates those existing categories.

## Delivery proposal

- Daily and weekly each produce one combined email with totals followed by every selected machine's numbers and requests. Both selected means separate daily and weekly messages.
- Timezone is shared across optional categories; daily time and weekly day/time are independent. Report periods follow machine-local dates, separate from delivery time.
- New-request immediate emails are optional; the daily and weekly digests already include request details. This UI deliberately omits the earlier sketch's ambiguous “Include in daily brief” dropdown. Users can choose digest-only by leaving the immediate category off.
- Optional quiet hours default to 8 PM–7 AM in the illustrated timezone. Immediate alerts queue until quiet hours end. Requested digest times inside that window move to the next allowed time, shown in the review summary. A weekly shift across midnight says following day.
- Offline bypass is explicit and initially off. Automatic manager notices keep their existing schedules and are unaffected by optional quiet hours.
- Scheduling details, daylight-saving handling, deduplication, long email clipping and client rendering remain implementation work. No new recurring automation is created by this prototype.

## Data readiness and recipient boundaries

Sales-quiet needs validated complete reporting periods and comparable baselines. Device-offline needs explicit fresh source status, a validated component identity and sustained observations. Both remain selected concepts; the prototype is not a claim those feeds are ready.

Technician reporting access is not blanket access to full refund records. Operational symptoms and a short redacted comment need a recipient-safe, deliberately authorized view. Exclude customer contact details, payment details, payout data, codes and private links. Production capability checks should determine each category's eligible machine list; the common sample scope is a design fixture.

Navigation evidence: `src/components/layout/AppLayout.tsx`, `src/components/layout/authenticatedNavigation.ts`, `src/components/auth/MemberRoute.tsx`, `src/components/portal/portalNavigation.ts`, `src/lib/technicianEntitlements.ts`. Existing manager semantics: `Docs/REFUND_WORKFLOW.md`, `Docs/QA_SMOKE_TEST_CHECKLIST.md`, and the round-two alert brief.

## Review and acceptance

Open `/Docs/alert-concepts/subscriptions.html` on the local Vite server. No credentials needed. The standalone file also opens with its adjacent CSS and JavaScript.

- Preferences: expand each category, choose different scopes, adjust delivery, cancel, save, and navigate away with a dirty draft.
- Reports: change machines, choose Subscribe to digest, review daily/weekly settings and save. Other alert categories retain their scopes.
- Machine: Reports → View details → Email alerts. Add/remove this machine, save and confirm central counts agree. Cancel preserves the saved state. Check last-machine removal and no reactivation of historical scopes.
- Setup: use a role suggestion or choose manually; test zero categories and zero machines; edit a per-alert scope at review; save and inspect confirmation.
- Role: Technician can reach Email alerts directly, sees two assigned machines, and has no manager decisions or Account link. Production requires a separate authorized operational view for any technician refund excerpt.
- Review states: no machine access shows assignment guidance; simulated save failure keeps the draft for retry. Set state back to Ready, then save without reentering choices.
- Desktop/mobile: inspect 1440, 900, 390 and 320px widths, keyboard focus, native-dialog focus containment, Escape/Cancel, readable errors and reachable save actions.

Screenshots and local browser checks are retained in `output/playwright/round-3/`. The root agent owns final integration, browser checks, repo checks and PR evidence. Product, access and design subagents contributed isolated advisory reviews.
