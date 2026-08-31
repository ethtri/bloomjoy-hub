# Refund Machine Activation Runbook

This runbook governs the owner-reviewed activation introduced by issue `#948`. It does not authorize an unattended production rollout.

## What the screen means

- **Ready to refund:** customer intake, transaction matching, exact active Nayax inventory, current Machine Manager routing, the machine payment gate, and global direct API availability are all ready. This state cannot appear while the remaining-value guard is active.
- **Ready to activate:** every machine prerequisite is ready, but the machine capability is intentionally off. The screen shows the approved reason; activation does not override global direct API availability.
- **Setup needed:** one machine prerequisite is missing. Fix the exact reason shown before activation.
- **Paused:** the global runtime pause applies to all machines. This is not a machine mapping failure.
- **Manual portal only:** machine capability, intake, and lookup remain ready, but direct API execution is blocked until Nayax remaining refundable value can be verified. Refund Operations may approve the reviewed portal fallback only for one exact matched transaction. After acting in Nayax, record completion only after verifying the portal shows the full selected transaction amount refunded; keep partial/smaller results on hold.

Customer intake is independent from transaction matching and payment activation. Turning matching off must not prevent a customer from asking Bloomjoy for help.

## Predeployment checks

1. Confirm the ordered dependency PRs for `#946` and `#947` are merged before the `#948` database/UI release.
2. Run `npm ci`, `npm run build`, `npm test`, `npm run lint -- --quiet`, `npm run db:validate-migrations`, `npm run db:validate-rpc-surface`, `npm run refunds:validate-machine-manager-uat`, and the refund release alignment/tooling checks.
3. Confirm the release check identifies the new migration and that production comparison remains read-only before deployment.
4. Confirm no unresolved provider attempt, duplicate-payment hold, or production incident requires the global kill switch to remain active.

## Owner UAT before activation

1. Open Admin → Machines and inspect examples of **Ready to activate**, **Setup needed**, **Manual portal only**, **Direct API blocked**, and an approved machine-disabled reason on desktop and mobile. **Ready to refund** may appear only when global direct availability is truly open.
2. Confirm **Customer requests**, **Transaction lookup**, **Machine Managers**, **Card-refund capability**, **Direct API**, and **Refund amount** remain separate and agree with the reviewed machine record.
3. Confirm the global pause appears as **Paused for all machines** and does not erase the underlying machine status.
4. For one qualified non-production fixture, choose **Activate card-refund capability**, confirm once, and verify the machine capability is `Enabled`. When `provider_remaining_value_unverified` is active, also verify **Manual portal only**, the direct API block, and the reviewed Nayax portal guidance; activation must not claim direct readiness.
5. Confirm the Admin audit log contains one activation event and that repeating the same request creates no second event.

## Reviewed production activation

Machine-capability activation is a separate owner-reviewed step after deployment and UAT. It does not enable or authorize the direct API.

Run the aggregate-only baseline and post-activation audit in `Docs/REFUND_SIMPLE_JOURNEY_RELEASE_RUNBOOK.md`. The post-activation run must pass without `--allow-not-ready` before the rollout proceeds.

- Use the single-machine action or **Activate qualified machine capabilities** for the reviewed qualified set.
- Bulk activation never overrides `owner_pause`, `provider_support`, `machine_maintenance`, or `commercial_exception`.
- A newly repaired mapping should appear as **Ready to activate** until this reviewed step occurs.
- Do not change runtime secrets, the global kill switch, the immutable remaining-value guard, or provider contracts from the machine screen.

## Rollback

Use the server activation boundary with one approved reason: owner pause, provider support, machine maintenance, or commercial exception. Rollback disables the machine capability, preserves customer intake, and writes one audit event. If the issue affects all machines, use the existing global runtime pause first, then investigate machine state without relabeling it as setup failure.

After rollback, verify there was no duplicate provider call, no unexpected reporting adjustment, and no customer completion message without confirmed provider success.
