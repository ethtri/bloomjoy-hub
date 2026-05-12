# Machine Manager Shadow UAT Script

Last updated: 2026-05-12

## Purpose
Use this script when Bloomjoy invites managers, operators, or partner operators into the new refund workflow during shadow mode. The goal is to confirm the workflow is easy to use before replacing the Google Form/AppSheet fallback.

Keep the current Google Form/AppSheet flow live. Managers should not use the new workflow as the only operational source until the shadow-pilot go/no-go checklist passes.

## Before The Session
- Use synthetic or owner-approved shadow-mode cases only.
- Do not paste real customer names, emails, phone numbers, card digits, Zelle contacts, complaint text, screenshots, or raw provider data into GitHub, docs, chat, or feedback notes.
- Confirm the tester has the right persona:
  - Machine Manager/operator: sees only assigned-machine refund cases at `/portal/refunds`.
  - Scoped admin: sees only scoped-machine refund cases.
  - Super admin: sees all refund cases and manages Machine Managers from Admin > Machines.
- Confirm the tester knows refunds are still completed manually in Nayax or Zelle for MVP.
- For agent visual QA, start the app with `npm run dev:uat` and use `http://127.0.0.1:8081`. Append `?demo=on` for clearly labeled demo-only review. Demo mode is not evidence that saves, access scope, Nayax lookup, or reporting write-through work.
- For functional QA, use seeded synthetic users/cases or post-production shadow-mode data with authenticated Machine Managers. The executive sponsor does not need to run this script before agents prove it works.

## Manager Script
1. Sign in to the Bloomjoy operator app.
2. Open `/portal/refunds`.
3. Confirm `Refunds` appears inside the Portal navigation, not as a top-level workspace tab.
4. Confirm the queue only shows refund cases for machines you manage.
5. Search for a known test case or select the first visible case.
6. Review the case summary:
   - customer contact
   - refund path
   - location and machine
   - issue summary
   - correlation evidence
7. Confirm the `Decision and next action` section is easy to find before event history.
8. Expand `Event timeline`.
9. Expand `Customer messages`.
10. For a card case, review the card lookup evidence and confirm no raw provider IDs are shown.
11. For a cash case, confirm the refund path says cash refund by Zelle and the Zelle contact is available only in the authorized workflow.
12. Try a decision path appropriate for the test case:
    - keep in review
    - waiting on customer
    - approve
    - deny
    - mark card refund pending
    - mark cash/Zelle pending
    - completed
13. If saving is blocked, confirm the error message tells you what is missing.
14. On a phone-sized screen, confirm the queue and detail are readable without sideways scrolling.

## Expected Results
- Machine Managers can open `/portal/refunds`.
- Machine Managers do not see the Admin workspace, Admin tools, Machine Manager setup, Nayax setup controls, machine setup identifiers, or raw provider payloads.
- `/admin` and `/admin/refunds` redirect refund-only users back to `/portal/refunds`.
- The queue is understandable at a glance.
- The selected case shows the decision area before timeline and message history.
- Timeline and customer messages are available but not crowding the default view.
- Denied cases require a friendly reason.
- Completed cases require the correct manual refund reference and correlation evidence.
- Nothing in the workflow suggests Bloomjoy automatically sends final approval, denial, or completion replies in MVP.

## Super Admin Machine Manager Setup Check
Use this only for super-admin/admin UAT, not for ordinary Machine Manager testers.

1. Open `/admin/machines`.
2. Edit a machine.
3. In `Machine Managers`, search for an authenticated user by name or email.
4. Add the user and confirm the status changes from saving to `Saved`.
5. Confirm there is no separate `Save Machine Managers` button.
6. Close the edit sheet and confirm the machine row shows the assigned manager email.
7. Reopen the same machine and confirm the assigned manager is still shown.
8. Confirm no machine can have more than 3 Machine Managers.

Functional UAT note: a Machine Manager email must belong to a user who has signed in to Bloomjoy at least once. If a non-authenticated email is entered, the UI should explain that the person needs to sign in once before assignment.

## Feedback Prompts
Capture manager feedback in GitHub issues or PR comments using this format.

```md
## Machine Manager shadow feedback
- Tester persona:
- Machine/location scope:
- Device: Desktop / Mobile
- Case reference:
- Result: PASS / PARTIAL / BLOCKED
- What was confusing:
- What felt slower than the old process:
- What felt faster than the old process:
- Missing information:
- Suggested change:
- Go/no-go impact:
```

## PM/PO Go/No-Go Notes
- Any access-boundary failure is a P0 blocker.
- Any private-data leakage is a P0 blocker.
- Any decision path that can write settlement adjustments without approved, completed, correlated evidence is a P0 blocker.
- Minor wording, spacing, or filter improvements can be parked as follow-up issues if managers can still complete the workflow without PM help.
- Cutover is not approved until shadow-mode cases complete end to end with fewer manual steps than the Google Form/AppSheet fallback.
