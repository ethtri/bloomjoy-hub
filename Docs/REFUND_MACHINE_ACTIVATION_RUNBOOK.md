# Refund Machine Activation Runbook

This runbook governs the owner-reviewed activation introduced by issue `#948`. It does not authorize an unattended production rollout.

## What the screen means

- **Ready to refund:** customer intake, transaction matching, exact active Nayax inventory, current Machine Manager routing, the machine payment gate, and a positive machine limit are ready. Runtime provider configuration must also be available.
- **Ready to activate:** every machine prerequisite is ready, but live card refunds are intentionally off. The screen shows the approved reason.
- **Setup needed:** one machine prerequisite is missing. Fix the exact reason shown before activation.
- **Paused:** the global runtime pause applies to all machines. This is not a machine mapping failure.

Customer intake is independent from transaction matching and payment activation. Turning matching off must not prevent a customer from asking Bloomjoy for help.

## Predeployment checks

1. Confirm the ordered dependency PRs for `#946` and `#947` are merged before the `#948` database/UI release.
2. Run `npm ci`, `npm run build`, `npm test`, `npm run lint -- --quiet`, `npm run db:validate-migrations`, `npm run db:validate-rpc-surface`, `npm run refunds:validate-machine-manager-uat`, and the refund release alignment/tooling checks.
3. Confirm the release check identifies the new migration and that production comparison remains read-only before deployment.
4. Confirm no unresolved provider attempt, duplicate-payment hold, or production incident requires the global kill switch to remain active.

## Owner UAT before activation

1. Open Admin → Machines and inspect at least one example of **Ready to refund**, **Ready to activate**, **Setup needed**, and an approved machine-disabled reason on desktop and mobile.
2. Confirm **Customer requests**, **Transaction lookup**, **Machine Managers**, **Card refunds**, and **Limit** agree with the reviewed machine record.
3. Confirm the global pause appears as **Paused for all machines** and does not erase the underlying machine status.
4. For one qualified non-production fixture or explicitly approved pilot machine, choose **Activate card refunds · $50 limit**, confirm once, and verify **Ready to refund**, `Enabled`, and `$50 per refund during launch`.
5. Confirm the Admin audit log contains one activation event and that repeating the same request creates no second event.

## Reviewed production activation

Activation is a separate owner go/no-go step after deployment and UAT.

- Use the single-machine action for a bounded pilot or **Activate qualified machines** for the reviewed qualified cohort.
- Bulk activation never overrides `owner_pause`, `provider_support`, `machine_maintenance`, or `commercial_exception`.
- A newly repaired mapping should appear as **Ready to activate** until this reviewed step occurs.
- Do not change runtime secrets, the global kill switch, daily caps, or provider contracts from the machine screen.

## Rollback

Use the server activation boundary with one approved reason: owner pause, provider support, machine maintenance, or commercial exception. Rollback disables the machine payment gate, clears its per-refund cap, preserves customer intake, and writes one audit event. If the issue affects all machines, use the existing global runtime pause first, then investigate machine state without relabeling it as setup failure.

After rollback, verify there was no duplicate provider call, no unexpected reporting adjustment, and no customer completion message without confirmed provider success.
