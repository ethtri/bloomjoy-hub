# Legacy machine correction and current observation

This is the backend-only extension to #971 / #628 and the authoritative receipt contract. It does not add a payment, customer message, accounting date, or UI. Production execution and merge require the separate release/review process.

## Supported boundary

Only a recognized September 1 legacy held manual attempt can use this action. The existing exact case/original/amount fingerprint, historical registration key, companion event actor/time, and held provider state remain mandatory. The original transaction and full USD refund amount stay unchanged; the fresh provider observation must be Refunded (62), not pending (63).

The caller must be an authenticated, non-anonymous current Super Admin with a live session and current active Machine Manager mappings on both the old and corrected machine. Service identities cannot impersonate this review. The correction must stay in the same exact reporting location, account, and incident timezone. An existing QR claim or explicit/grouped intake selection is unsupported and fails closed. Ordinary direct-form intake with no such binding is supported without inventing customer or email provenance.

The target must have an active, published inventory row whose account, immutable provider machine ID, numeric machine number, and reporting-machine link match the reviewed evidence. The complete inventory snapshot is hashed by the database. Inventory refresh, mapping revocation, stale case version, existing receipt/adjustment, unrecognized attempt, or in-flight customer delivery rejects the action.

## Backend contract

`admin_get_refund_legacy_machine_correction_options(case_id)` returns actor-scoped target identities and their inventory evidence digests. This is review input, not an authorization token or an eligibility promise. The mutation rechecks every guard under locks.

The authenticated admin update mode `correct_legacy_machine_and_record_observation` takes all ordinary receipt fields plus `expectedOldMachineId`, `targetMachineId`, `inventoryId`, `inventoryEvidenceDigest`, and `machineNumber`. `attemptId` is required and `reviewedCurrentProviderObservation` must be true. Extra caller actor IDs, observation/settlement timestamps, or customer-provenance flags are rejected.

One database transaction changes only the current case machine binding and invokes the existing authoritative receipt recorder using the new server-derived case version. Existing assignment/version/fact triggers retain their normal semantics. If receipt recording fails, the machine change rolls back too. An immutable private correction audit links both machines, the unchanged location, inventory snapshot/number, historical event, historical attempt digest, actor, and server observation time. A repeated correction fails closed; it never makes another payment, receipt, or message.

The selected-transaction overview identifies the corrected current machine but removes historical candidate match factors, network/recognition annotations, and inferred time precision. Original sale time, original customer/QR/intake evidence, historical attempt/events, and already-sent mail remain unchanged. Notice adoption is still a separate reviewed operation; prior manager CC is not rewritten or resent.

## Verification and remaining work

- `npm run refunds:validate-authoritative-receipt` exercises strict backend request/response handling and the existing receipt tests.
- `npm run db:validate-migrations` applies the full migration chain to a disposable database and runs `supabase/tests/refund_legacy_machine_correction.sql`: negative evidence/authority checks, atomic rollback, immutable history, projection, and actual two-session correction/resolver/mapping/inventory races.
- No production data or customer/provider identifiers belong in fixtures or PR evidence.
- UI review, snapshot-bound operator confirmation, browser readback, and independent review remain separate work. This backend slice is not end-to-end acceptance.

Rollback before any execution is a source rollback of the unexposed backend action. After a correction exists, preserve its audit/receipt and use a separately reviewed forward repair; do not delete evidence or reverse a binding directly.
