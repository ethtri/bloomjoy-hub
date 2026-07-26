# Refund QR Shadow Pilot Packet

Last updated: 2026-07-26

Status: ready to execute after `#664` is merged/deployed and the sponsor approves the exact six-machine cohort. This packet and its automated fixtures are preparation evidence; they are not proof that the physical pilot occurred.

## Plain-English purpose

This pilot tests whether the machine QR scan gives managers enough trusted machine-and-time evidence to find the right Nayax sale without guessing. It does not test whether a product actually dispensed, and it does not turn on automatic refunds.

The pilot has three parts:

1. Print and attach one machine-specific QR label to each of six approved machines.
2. Run controlled purchases and real refund reviews while managers continue to make every decision and use the existing authorized Nayax portal.
3. Produce one sanitized report containing counts and outcomes only, then ask the sponsor to keep, tighten, or disable each recommendation class.

## Start gate

Do not begin field testing until all are true:

- `#662`, `#663`, and `#664` are merged and deployed to the controlled pilot environment.
- The sponsor approves the exact six machines, responsible managers, fallback owner, and same-day stop/go contact.
- Admin > Machines shows one current active QR version for every approved machine.
- Live in-app Nayax execution, automatic approval, and automatic payout remain disabled.
- The legacy Google Form/Sheet/AppSheet fallback remains available.

## Field checklist for each machine

Follow `Docs/REFUND_QR_ASSET_ROLLOUT.md` and perform the work on one machine at a time.

| Check | Pass condition |
| --- | --- |
| Print | The current SVG is downloaded from that machine's private Admin > Machines record. |
| Install | The label is physically attached to the machine named on the label. |
| Human label check | A second person confirms the printed location/machine label matches the physical machine. |
| Real-phone scan | Scanning the installed label opens the production Bloomjoy refund form and shows the expected machine/location. |
| Replacement owner | One accountable role is recorded in Admin > Machines. |

After all six pass, perform one controlled rotation:

1. Rotate one approved QR with a non-customer reason.
2. Confirm the retired label shows the safe unavailable path and cannot start a valid claim.
3. Print/install the replacement and repeat every rollout check for the new version.

Never paste QR codes, internal machine IDs, Nayax IDs, claim IDs, or customer/payment data into GitHub.

## Controlled scenario matrix

Run `npm run refunds:validate-qr-shadow-pilot` before field testing. Then exercise the equivalent real/sanitized scenarios during the approved window.

| Scenario | Required result |
| --- | --- |
| Ordinary physical card with one matching sale | `high_confidence / strong_card`; manager still confirms the sale. |
| Apple Pay/mobile-wallet virtual-last-four mismatch with one unique sale | `high_confidence / unique_qr_time`; manual Nayax portal only. |
| Single contactless sale with one unique QR/time fit | `high_confidence / unique_qr_time`; manual Nayax portal only. |
| Two same-price sales close together | `ambiguous`; no recommended selection and no enabled execution. |
| Wrong or uncertain amount | Manual exception or no safe match; no recommendation. |
| QR scanned too late | Manual exception; QR time must not create a recommendation. |
| Missing QR evidence | No QR-based recommendation. |
| Direct-form intake | No QR-based recommendation. |
| Nayax lookup failure | Safe failure state; no recommendation, refund, email, or automatic retry. |

Any known false-positive high-confidence recommendation pauses that confidence class immediately. Preserve only sanitized counts, open a P0 defect, and do not widen the pilot.

## What Operations records

Keep the two input files outside the repository.

Private cohort file:

```json
{
  "schemaVersion": "2026-07-26.v1",
  "sponsorApprovedPilotCohort": true,
  "machineIds": [
    "<private-machine-uuid-1>",
    "<private-machine-uuid-2>",
    "<private-machine-uuid-3>",
    "<private-machine-uuid-4>",
    "<private-machine-uuid-5>",
    "<private-machine-uuid-6>"
  ]
}
```

Sanitized observations file:

```json
{
  "schemaVersion": "2026-07-26.v1",
  "physicalMachineChecks": {
    "expected": 6,
    "passed": 0,
    "failed": 6
  },
  "controlledFixtures": {
    "expected": 9,
    "passed": 0,
    "failed": 9,
    "knownFalsePositiveHighConfidence": 0
  },
  "operations": {
    "managerFrictionCount": 0,
    "customerFrictionCount": 0,
    "qrDamageOrReplacementCount": 0,
    "fallbackRequiredCount": 0
  },
  "rollback": {
    "qrIdentifiersDisabled": false,
    "recommendationsDisabled": false,
    "directIntakeOperational": false,
    "managerQueueOperational": false
  },
  "stopConditionTriggered": false
}
```

The zero/false starting values intentionally make an incomplete pilot fail its gates. Replace them only with observed results.

## Generate the sanitized report

Use a server-only environment file and the exact production project reference:

```powershell
npm run refunds:report-qr-shadow-pilot -- `
  --project-ref <project-ref> `
  --env-file <server-only-env-file> `
  --cohort-file <private-cohort-json> `
  --observations-file <sanitized-observations-json> `
  --start <pilot-start-ISO> `
  --end <pilot-end-ISO> `
  --output-file output/refund-qr-shadow-pilot/evidence.json
```

The command makes bounded Supabase reads only. It does not call Nayax, write production data, refund a payment, or output machine, case, claim, transaction, customer, or card identifiers.

Review the report before sharing it. It must include:

- total cases and card/wallet/cash split
- verified/missing/invalid QR evidence
- QR-to-reported-time buckets
- high-confidence counts by `strong_card` and `unique_qr_time`
- ambiguous, manual-exception, no-safe-match, and not-evaluated counts
- manager acceptance, alternate selections, and structured disagreement reasons
- Nayax lookup failure/setup counts
- controlled false-positive, friction, QR damage/replacement, and fallback counts
- rollback result and sponsor-review readiness

## Rollback proof

Prove rollback during the controlled window without deleting audit history:

1. Disable the selected machine QR identifiers/recommendations using the approved controls.
2. Confirm disabled QR links fail safely.
3. Confirm direct refund intake still opens.
4. Confirm the manager refund queue still operates.
5. Restore only the explicitly approved pilot configuration.

If rollback fails, stop the pilot. Do not broaden access or turn on live execution.

## Sponsor go/no-go note

Post only sanitized aggregate evidence to `#665`:

```markdown
## Six-machine QR refund pilot decision
- Pilot window:
- Release commit / manifest:
- Physical machines passed: __ / 6
- Controlled scenarios passed: __ / 9
- Known false-positive high-confidence findings:
- Strong-card outcomes:
- Unique QR/time outcomes:
- Ambiguous / manual / no-safe-match outcomes:
- Manager overrides and reasons:
- QR-to-reported-time summary:
- Wallet / non-wallet card / cash split:
- Manager/customer friction:
- QR damage/replacement observations:
- Cases needing the still-TBD fallback:
- Rollback proven: yes/no
- Stop condition triggered: yes/no
- Recommendation by confidence class: keep / tighten / disable
- Sponsor decision: GO / LIMITED GO / NO-GO
```

The issue stays open until the sponsor records that decision. A passing source test or demo screenshot cannot substitute for the six physical installs, real-phone scans, controlled cases, manager review, and rollback proof.
