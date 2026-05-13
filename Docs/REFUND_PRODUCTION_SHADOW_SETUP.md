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

## Cohort Setup Template

Generate a local editable pilot cohort template from the readiness audit:

```powershell
npm run refunds:pilot-cohort-config -- --create-template --readiness-dir output/refund-pilot-readiness
```

This creates `output/refund-pilot-readiness/pilot-cohort-config-template.csv`. Fill in only the machines selected for the shadow pilot:

- `selected_for_pilot`: set to `yes` only for selected pilot machines.
- `manager_email_1`, `manager_email_2`, `manager_email_3`: one to three authenticated Machine Managers.
- `nayax_machine_id_to_apply`: the reviewed Nayax machine ID for card lookup.
- `public_display_label_to_apply`: customer-facing label shown on `/refunds/request`.

The template may include high-confidence Nayax suggestions from the read-only inventory audit, but every selected row still needs human review before apply.
If a machine should receive Machine Managers now but should not appear on public refund intake yet, keep `selected_for_pilot=yes` and set `enable_refund_intake=no`. Rows with public intake enabled require a Nayax machine ID unless the operator explicitly uses `--allow-missing-nayax`.

Dry-run the filled template before any production setup write:

```powershell
npm run refunds:pilot-cohort-config -- --file output/refund-pilot-readiness/pilot-cohort-config-template.csv --env-file C:\Repos\Bloomjoy_hub\.env --project-ref ygbzkgxktzqsiygjlqyg
```

Apply only after the dry-run is clean and the selected rows are intentional:

```powershell
npm run refunds:pilot-cohort-config -- --file output/refund-pilot-readiness/pilot-cohort-config-template.csv --env-file C:\Repos\Bloomjoy_hub\.env --project-ref ygbzkgxktzqsiygjlqyg --apply --confirm-project-ref ygbzkgxktzqsiygjlqyg --actor-email <super-admin-email> --reason "Refund shadow pilot cohort setup"
```

The apply path refuses missing authenticated Machine Managers, refuses more than three managers, refuses missing Nayax IDs unless explicitly overridden, requires a confirmed project ref, requires an active super-admin actor, writes an admin audit entry, and never enables live Nayax refund execution.

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
