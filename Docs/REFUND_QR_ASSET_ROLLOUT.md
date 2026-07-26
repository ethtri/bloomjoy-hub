# Refund QR Asset Rollout

Last updated: 2026-07-26

Use this runbook for the six-machine refund shadow pilot. Admin > Machines is the source of truth for the current QR version and rollout checks; do not copy opaque codes, internal machine IDs, or Nayax IDs into a spreadsheet, issue, or chat.

## What the tool does

For each active refund-intake-enabled Commercial or Mini machine, an authorized Super Admin or in-scope Scoped Admin can:

1. Create one active opaque refund QR code.
2. Download a print-ready SVG labeled with the customer-facing location and machine name.
3. Copy the production refund link when a controlled digital check is needed.
4. Record that the exact version was printed, installed, label-checked, and scanned on a real phone.
5. Assign replacement responsibility to Bloomjoy Operations, the Machine Manager, or the Site Partner without storing a person's name.
6. Rotate or disable the code with an audited reason.

The QR only identifies the machine and lets the server record when the customer opened the link. It does not identify the customer, prove delivery failure, approve a refund, or enable live Nayax execution.

## Six-machine signoff

Open Admin > Machines and find the `Refund QR pilot ready` card.

- The public refund machine count must match the approved cohort of six before installation begins.
- Each enabled machine row must show one active QR version.
- Each physical asset must be managed from that machine's own Edit Machine sheet. Do not download one label and reuse it on another machine.
- Pilot signoff requires `6` ready machines. A lower count means the pilot remains paused.

For every machine, complete these checks in order:

| Check | What must be true |
| --- | --- |
| Approved asset printed | The SVG came from the current machine record and the filename/version match the screen. |
| Installed on this machine | The printed version is physically attached to the machine whose human-readable label appears on the asset. |
| Printed label matches | A person compares the location and machine label on the asset with the physical machine. |
| Real-phone scan verified | A person scans the installed code on a real phone and sees the expected Bloomjoy refund page and machine/location. |
| Replacement owner | One accountable role is selected for damaged, missing, retired, or incorrect labels. |

Synthetic desktop/mobile browser evidence proves the software behavior. It does not count as the real-phone check for a physical machine.

## Create and print

1. Confirm Machine Manager, public display label, and read-only Nayax mapping are correct.
2. Save refund intake as enabled.
3. Reopen the machine and choose `Create refund QR`.
4. Download the SVG and print it at full size without cropping the quiet area around the code.
5. Mark `Approved asset printed` only after the physical label exists.
6. Install and complete the remaining checks on site.

The asset always targets `https://app.bloomjoyusa.com/refunds/request` with an opaque code. It never uses localhost, a preview URL, a raw reporting-machine ID, or a Nayax identifier.

## Rotate or disable safely

Rotate when a label is lost, damaged, copied to the wrong machine, or otherwise cannot be trusted.

1. Choose `Rotate`, enter a non-customer reason, and confirm.
2. Treat every copy of the prior version as retired immediately.
3. Download and install the new version.
4. Complete the fresh rollout checklist; prior-version checks do not carry forward.
5. Scan the retired code in a controlled check and confirm the safe unavailable-code message.

Disable when the machine leaves the pilot or refund intake must pause. Turning off refund intake also disables the active QR automatically. A disabled or retired code cannot start a valid claim and its admin payload no longer returns the old public path.

## Evidence and privacy

Allowed issue/PR evidence:

- machine count and ready count
- QR version number and status
- sanitized desktop/mobile screenshots with synthetic data
- aggregate pass/fail for the six physical phone scans
- audit action and reason code without the public code

Do not post:

- the opaque QR value or full claim link
- internal/reporting/Nayax machine IDs
- customer or payment data
- card digits, provider transaction IDs, or complaint text

## Rollback

If placement or routing is uncertain, disable the affected machine's code and keep the legacy refund fallback available. Do not rotate repeatedly to troubleshoot. Confirm the machine record and printed label first, then create one controlled replacement and repeat all rollout checks.
