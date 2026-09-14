# Refund machine readiness reference

Issue `#948` introduced the truthful readiness model and is complete. This file
describes the current steady state; its historical rollout sequence is retired.
It is subordinate to [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) and cannot add a
pilot, owner approval, customer prerequisite, or second Manager decision.

## What the screen means

- **Ready to refund:** customer intake, transaction matching, exact active Nayax
  inventory, current Machine Manager routing, the machine payment capability,
  and global direct API availability are ready.
- **Ready to activate:** the machine configuration is complete, but its payment
  capability is off. An authorized Admin may enable that configuration once; it
  is not a per-case or owner approval.
- **Setup needed:** repair the exact mapping, timezone, location, Manager route,
  or provider configuration shown.
- **Paused:** a demonstrated global incident has paused direct execution. This is
  not a machine mapping failure.
- **Direct API blocked:** keep the case in Bloomjoy Hub and show the Manager the
  System problem. Never issue or record a manual Nayax refund.

Customer intake remains independent from matching and payment readiness. Turning
matching or payment execution off must not prevent a customer from asking
Bloomjoy for help.

## Routine configuration

1. Fix only the concrete readiness item shown for the affected machine.
2. Confirm the exact account, immutable provider machine ID, location timezone,
   public label, and current Machine Manager route.
3. If the screen shows **Ready to activate**, use the existing single-machine or
   qualified-set action. Repeating the same request must create no second event.
4. Verify the resulting status and continue refund case work.

Do not disable unrelated machines, create a cohort, wait for the owner, or run a
live customer refund merely to prove a configuration change. Use proportionate
synthetic coverage when the readiness UI or contract changes.

## Incident response

For a machine-specific maintenance or mapping problem, disable only that
machine's capability with the factual reason and preserve intake. For a genuine
systemic payment defect, use the existing global runtime pause, preserve every
attempt and audit record, and continue safe research and customer communication.

After repair, verify no duplicate provider call or customer completion occurred,
then restore the prior operating state. A configuration repair does not require
another business approval or a new rollout ceremony.
