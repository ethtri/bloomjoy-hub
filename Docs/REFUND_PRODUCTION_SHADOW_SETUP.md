# Refund Production Shadow Setup

Use this runbook after the refund platform migrations/functions are deployed but before managers are invited to process live shadow-mode cases. This setup does not cut over from the Google Form/AppSheet fallback and does not enable live Nayax refund execution.

## Read-Only Readiness Audit

Run the local-only audit from the refund worktree:

```powershell
npm run refunds:pilot-readiness -- --env-file C:\Repos\Bloomjoy_hub\.env --project-ref ygbzkgxktzqsiygjlqyg --include-nayax
```

The audit writes local-only files under `output/refund-pilot-readiness/`:

- `summary.json` with aggregate readiness counts.
- `machine-readiness.csv` with each active reporting machine, Machine Manager count, public intake status, Nayax lookup status, and suggested setup action.
- `nayax-machine-inventory.csv` with sanitized Nayax machine inventory fields.
- `nayax-mapping-candidates.csv` with best-effort mapping candidates for Admin > Machines setup.

Do not commit the output files. Do not paste customer PII, card digits, raw Nayax payloads, Zelle details, or secrets into GitHub, docs, screenshots, or chat.

## Readiness Rule

A machine is ready for card-capable refund shadow UAT only when:

- Public refund intake is enabled for that machine.
- At least one Machine Manager is assigned.
- No more than three Machine Managers are assigned.
- A Nayax machine ID is configured for read-only card lookup.
- Live Nayax refund execution remains disabled unless a later sponsor go/no-go explicitly changes that.

It is valid for a machine to have one Machine Manager. The limit is a maximum of three, not a requirement to assign three.

## Admin Setup Path

Use `Admin > Machines > Edit Machine` for each selected pilot machine:

1. Confirm the machine identity and customer-facing label are clear.
2. Assign one to three Machine Managers using authenticated user emails.
3. Enable public refund intake only for the selected pilot machines.
4. Add the Nayax machine ID and account key where card lookup should work.
5. Leave live Nayax refund execution disabled.

Machine Managers process cases from `Portal > Refunds`. They should not need access to Admin setup screens.

## Pilot Gate

After the selected pilot machines are configured, run functional shadow UAT before executive proof review:

- Public `/refunds/request` shows only enabled pilot machines.
- Manager access is scoped to assigned machines.
- Card lookup returns sanitized candidate evidence for mapped machines.
- No-match cases send the friendly more-info workflow.
- Approved/completed correlated cases write reporting adjustments with `source='refund_case'`.
- Partner-facing reporting excludes PII, card digits, raw complaint text, raw Nayax payloads, and Zelle details.

Keep the Google Form/AppSheet process live until the shadow pilot demonstrates a cleaner end-to-end workflow.
