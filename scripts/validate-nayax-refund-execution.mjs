#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase/migrations/20260913090000_refund_single_manager_gate.sql');
const reviewedDecision = read('supabase/migrations/20260925020000_refund_reviewed_card_final_decision.sql');
const hardening = read('supabase/migrations/20260914052555_refund_single_manager_db_guards.sql');
const edge = read('supabase/functions/nayax-card-refund/index.ts');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const queue = read('supabase/functions/_shared/nayax-refund-attempt-queue.ts');
const gates = read('supabase/functions/_shared/nayax-refund-gates.ts');
const provider = read('supabase/functions/_shared/nayax-refund-provider.mjs');
const adminUpdate = read('supabase/functions/refund-case-admin-update/index.ts');
const operations = read('src/lib/refundOperations.ts');
const refundsUi = read('src/pages/admin/Refunds.tsx');
const config = read('supabase/config.toml');

assert.match(migration, /admin_approve_selected_nayax_refund_for_system_v1/);
assert.match(migration, /insert into public\.refund_case_nayax_refund_attempts/);
assert.match(migration, /refund_case_id,actor_user_id,execution_mode,status,idempotency_key/);
assert.match(migration, /sanitized_request,sanitized_response,official_action_authorization_id/);
assert.match(migration, /'\{\}'::jsonb,approval\.id,null/);
assert.match(hardening, /service_claim_due_nayax_refund_attempts_v1/);
assert.match(hardening, /for update of attempt skip locked/);
assert.match(hardening, /refund_nayax_current_continuation_proof_matches_v1/);
assert.match(hardening, /guard_refund_nayax_provider_generation_plan_v1/);
assert.match(hardening, /refund_nayax_system_success_one_reference_idx/);
assert.match(migration, /service_reclaim_nayax_refund_attempt_no_call_v1/);
assert.match(migration, /service_settle_nayax_refund_attempt\(/);
assert.match(migration, /provider_transport_unknown|provider_outcome_unknown/);
assert.match(migration, /reconciliation_required=true/);

assert.match(edge, /new Set\(\["execute", "availability", "approve_reviewed"\]\)/);
assert.match(edge, /admin_approve_selected_nayax_refund_for_system_v1/);
assert.match(edge, /parseReviewedFinalDecisionRequest\(body\)/);
assert.match(edge, /parseReviewedFinalDecisionReceipt\(data, refundCase\.id\)/);
assert.match(reviewedDecision, /admin_approve_reviewed_nayax_candidate_v1/);
assert.match(reviewedDecision, /admin_approve_selected_nayax_refund_for_system_v1/);
assert.match(reviewedDecision, /refund_reviewed_card_candidate_set_snapshot_v1/);
assert.match(gates, /NAYAX_REFUND_ATTEMPT_QUEUE_ENABLED/);
assert.match(gates, /NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY/);
const executeReadinessCheck = edge.lastIndexOf('const executionReadiness = await resolveCaseRefundReadiness');
const approvalWrite = edge.indexOf('"admin_approve_selected_nayax_refund_for_system_v1"');
const reviewedWrite = edge.indexOf('"admin_approve_reviewed_nayax_candidate_v1"');
const freshActionCheck = edge.indexOf('const { data: actorCanPerformOfficialAction');
assert.ok(executeReadinessCheck >= 0 && approvalWrite > executeReadinessCheck,
  'The execute request must recheck payment readiness before saving approval');
assert.ok(reviewedWrite >= 0 && reviewedWrite < executeReadinessCheck,
  'The reviewed final decision can queue a held attempt before processor availability');
assert.ok(reviewedWrite < freshActionCheck,
  'A lost reviewed-decision response remains readable after a terminal receipt closes fresh-action capability');
assert.doesNotMatch(edge, /approve_pending_request|service_reserve_nayax_refund_manager_action|orchestrateNayaxRefund/);
assert.match(sweep, /service_claim_due_nayax_refund_attempts_v1/);
assert.match(sweep, /service_reclaim_nayax_refund_attempt_no_call_v1/);
assert.match(sweep, /service_settle_nayax_refund_attempt/);
assert.match(sweep, /service_hold_nayax_refund_attempt_v1/);
assert.match(sweep, /createNayaxRefundProviderAdapter/);
assert.doesNotMatch(sweep, /service_claim_due_nayax_approval_continuations_v1|approval_continuation/);
assert.match(migration, /j\.event='started'/);
assert.match(queue, /settlementTry < 2/);
assert.match(queue, /await durablyHold\(claim\.attemptId/);
assert.match(queue, /rootAttemptId !== attemptId/);

assert.match(gates, /NAYAX_REFUND_EXECUTION_KILL_SWITCH/);
assert.match(gates, /NAYAX_REFUND_IDEMPOTENCY_SECRET/);
assert.doesNotMatch(gates, /NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS|NAYAX_REFUND_DAILY_COUNT_CAP/);
assert.match(provider, /refund-request/);
assert.match(provider, /refund-approve/);
assert.match(provider, /redirect: "error"/);

assert.match(adminUpdate, /card_approval_requires_refund_action/);
assert.match(adminUpdate, /card_completion_requires_system_settlement/);
assert.doesNotMatch(adminUpdate, /resolveNayaxRefundAttemptQueueReadiness/);
assert.match(sweep, /NAYAX_REFUND_ATTEMPT_QUEUE_ENABLED/);
assert.match(sweep, /nayax_refund_attempt_queue_disabled/);
assert.doesNotMatch(operations + refundsUi, /step_up_pending|provider_confirmed_retry_safe|documented_manual_completion|manualPortalAttempt/);
assert.match(config, /refund-manager-action-step-up/);
assert.match(config, /refund-manager-totp-enrollment/);
assert.doesNotMatch(edge + sweep, /refund-manager-action-step-up|refund-manager-totp-enrollment/);

console.log('Nayax refund execution validation passed (single approval, System-owned queue, one-attempt settlement).');
