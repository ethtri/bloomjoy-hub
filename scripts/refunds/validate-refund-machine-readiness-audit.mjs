#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MACHINE_READINESS_QUERY,
  determineReadiness,
  parseArgs,
  validateAggregateRow,
} from './refund-machine-readiness-audit.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');
const fixture = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'scripts', 'refunds', 'fixtures', 'simple-card-refund-journey.json'),
  'utf8'
));

assert.deepEqual(parseArgs([
  '--project-ref', 'project-ref', '--confirm-project-ref', 'project-ref', '--allow-not-ready'
]), {
  projectRef: 'project-ref',
  confirmProjectRef: 'project-ref',
  allowNotReady: true,
  help: false,
});
assert.throws(() => parseArgs(['--unknown']), /Unknown or incomplete argument/);

const readyRow = validateAggregateRow({
  read_only: true,
  active_customer_machine_count: 3,
  ready_to_refund_count: 2,
  ready_to_activate_count: 0,
  setup_needed_count: 0,
  approved_exception_count: 1,
  unexplained_disabled_count: 0,
  over_standard_cap_count: 0,
  tulsa_machine_count: 1,
  tulsa_ready_to_refund_count: 1,
  tulsa_reviewed_blocker_count: 0,
  tulsa_unexplained_count: 0,
  nonterminal_confirmed_case_count: 2,
  confirmed_case_ready_count: 1,
  confirmed_case_blocked_count: 1,
  confirmed_case_unknown_count: 0,
});
assert.equal(determineReadiness(readyRow).ready, true);
assert.equal(determineReadiness({ ...readyRow, ready_to_activate_count: 1, ready_to_refund_count: 1 }).ready, false);
assert.equal(determineReadiness({ ...readyRow, confirmed_case_unknown_count: 1 }).ready, false);
assert.throws(
  () => validateAggregateRow({ ...readyRow, leaked_machine_id: 'no' }),
  /unexpected columns/
);

assert.match(MACHINE_READINESS_QUERY, /true as read_only/i);
assert.match(MACHINE_READINESS_QUERY, /refund_case_card_refund_readiness/i);
assert.match(MACHINE_READINESS_QUERY, /awaiting_reviewed_activation/i);
assert.match(MACHINE_READINESS_QUERY, /owner_pause.*provider_support.*machine_maintenance.*commercial_exception/is);
assert.match(MACHINE_READINESS_QUERY, /between 1 and 5000/i);
assert.match(MACHINE_READINESS_QUERY, /not activation_prerequisites_ready\s+and not approved_exception/i);
assert.doesNotMatch(MACHINE_READINESS_QUERY, /\b(insert|update|delete|truncate|alter|drop)\b/i);

assert.equal(fixture.schemaVersion, 1);
assert.equal(fixture.evidenceClass, 'sanitized_synthetic');
assert.equal(fixture.machine.customerLabel, 'Tulsa Premium Outlets — Cotton Candy');
assert.equal(fixture.case.amountCents, fixture.candidate.amountCents);
assert.equal(fixture.case.currencyCode, fixture.candidate.currencyCode);
assert.equal(fixture.case.reportedCardLast4, fixture.candidate.cardLast4);
assert.equal(fixture.candidate.timeDeltaMinutes, 2);
assert.equal(fixture.candidate.paymentStatus, null);
assert.equal(fixture.candidate.selectionAllowed, true);
assert.equal(fixture.activation.disabledBlockReason, 'machine_not_enabled');
assert.equal(fixture.activation.standardLimitCents, 5000);
assert.doesNotMatch(JSON.stringify(fixture), /@[a-z0-9.-]+|providerTransactionId|nayaxMachineId/i);

console.log('Refund machine readiness audit tooling validated.');
console.log('- exact-project, linked, read-only execution boundary');
console.log('- aggregate-only machine, Tulsa, cap, and confirmed-case results');
console.log('- HOLD on unexplained disablement, unactivated eligible machines, unknown case action, or over-cap state');
console.log('- sanitized simple-journey fixture with unavailable provider approval field');
