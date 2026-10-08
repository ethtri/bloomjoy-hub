# Recovering historical source tax

Card reporting uses original transaction tax first, then applicable dated
account/reader observations. Follow the source-backed tax decision in
`DECISIONS.md` and the amount contract in `SALES_SOURCE_FIELD_CONTRACT.md`.
Cash remains the amount collected. Recovery never changes a reader setting,
source ownership, refund decision, payment or issued statement.

## Inventory the missing evidence

Run `scripts/nayax/tax-recovery-inventory.sql` with authorized private-schema
read access after editing its bounded report dates. This SELECT-only query
lists unresolved components with their booking and original purchase dates.
Keep the result in gitignored `output/`. It includes source identities for
research, so publish only aggregate summaries to GitHub.

The source-reader tuple comes from retained original Nayax sale rows, a matched
sale, an authoritative receipt or the selected lookup candidate. Current machine
mapping is separate context. An authority daily row can be traced to retained
Nayax rows even when their published money was zeroed to prevent double counting.
Multiple candidate accounts/readers remain reviewable; the query never allocates
an aggregate sale across ambiguous readers or copies today's reader into a
historical refund. This audit covers stored machine components and does not
replace a consumer's role/company/tender scope or its report totals.

`dated_evidence_present_inspect_normalizer` means an unresolved component has
potentially applicable evidence and needs calculation review. It does not
authorize a correction. `dated_tax_evidence_unavailable` identifies an exact
source tuple lacking applicable dated coverage. `original_reader_unavailable`
identifies a missing original source identity; the current mapping is not proof.

## Inspect preserved exports

After `npm ci`, run:

```powershell
node scripts/nayax/audit-dtm-tax-evidence.mjs C:/private/source.xlsx
npm run nayax:validate-dtm-history
```

The export audit prints only the workbook SHA-256, column count, possible tax
column names and unclassified extra-charge column names. It emits no payment
rows, identifiers, machine names or file paths. A tax column requires its exact
source amount/basis contract before use. An extra charge is not automatically
tax; absent columns and zero default values do not prove an exemption. The
approved money importer's column contract remains unchanged.

## Apply only supported intervals

Research the exact original transaction, then dated Nayax history and existing
Finance evidence. Reuse the existing `nayax_machine_tax_observations` ledger and
its bounded `nayax_portal_history` path for reviewed historical evidence. Retain
the real review time, exact account/reader, event timestamp, displayed timezone
or its uncertainty, checked history range, source field and evidence digest.
Current API observations cannot be backdated. A Finance confirmation bounded to
September cannot cover October or another reader with a similar venue name.

After an authorized correction, recalculate the affected interval through the
shared reporting path and rerun the inventory. Preserve raw imports and issued
snapshots. Where source access or historical evidence is unavailable, record
the specific reader/date/field dependency under #1592 and keep the affected
report visibly partial while unrelated verified remediation proceeds.
