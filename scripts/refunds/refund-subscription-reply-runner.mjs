import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  deriveSourceBoundFacts, findKnownFactDirectionalTime, validateClaim,
  validateDeferral, validateIncidentTime, validateNoFactReview,
  validateProposalShape,
  validateResearchInput,
} from './refund-subscription-reply-runner-lib.mjs';

export const PROJECT_REF = 'ygbzkgxktzqsiygjlqyg';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stateRoot = path.join(repoRoot, 'output', 'refund-subscription-reply-runs');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const fail = (code) => { throw new Error(code); };
const safeRunPath = (runId) => {
  if (!uuid.test(runId ?? '')) fail('invalid_run_id');
  return path.join(stateRoot, `${runId}.json`);
};
const readState = (runId) => JSON.parse(fs.readFileSync(safeRunPath(runId), 'utf8'));
const writeState = (state) => {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const file = safeRunPath(state.runId);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
};

export const readLocalSupabaseServiceKey = (spawn = spawnSync) => {
  const result = spawn('supabase', [
    'projects', 'api-keys', '--project-ref', PROJECT_REF, '--output', 'json',
  ], { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 500_000 });
  if (result.error || result.status !== 0) fail('credential_unavailable');
  let keys;
  try { keys = JSON.parse(result.stdout); } catch { fail('credential_unavailable'); }
  const matches = Array.isArray(keys) ? keys.filter((entry) =>
    entry?.type === 'legacy' && entry?.name === 'service_role' &&
    typeof entry?.api_key === 'string' && entry.api_key.length > 30) : [];
  if (matches.length !== 1) fail('credential_unavailable');
  return matches[0].api_key;
};

export const createProductionClient = ({ spawn = spawnSync } = {}) => {
  const key = readLocalSupabaseServiceKey(spawn);
  return createClient(`https://${PROJECT_REF}.supabase.co`, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-refund-reply-runner': 'codex-subscription-v1' } },
  });
};

const rpc = async (client, name, args = {}) => {
  const { data, error } = await client.rpc(name, args);
  if (error) fail(`${name}_failed`);
  return data;
};

export const beginRun = async (client, at = new Date()) => {
  const scheduledHour = new Date(at);
  scheduledHour.setUTCMinutes(0, 0, 0);
  const started = await rpc(client, 'service_start_refund_reply_subscription_run', {
    p_scheduled_hour: scheduledHour.toISOString(),
  });
  if (started?.outcome !== 'started' || !uuid.test(started?.runId ?? '')) {
    return { outcome: started?.outcome ?? 'unavailable', status: started?.status ?? null };
  }
  const claim = await rpc(client, 'service_claim_refund_scoped_reply_reviews', { p_limit: 8 });
  const tasks = Array.isArray(claim?.tasks) ? claim.tasks.map(validateClaim) : [];
  const state = {
    runId: started.runId, scheduledHour: scheduledHour.toISOString(),
    tasks, results: {},
  };
  writeState(state);
  return { outcome: 'started', runId: state.runId, taskCount: tasks.length,
    requestIds: tasks.map((task) => task.requestId), payloadRedacted: true };
};

const taskFromState = (state, requestId) => {
  const task = state.tasks.find((item) => item.requestId === requestId);
  if (!task) fail('request_not_in_run');
  return task;
};

export const getContext = async (client, runId, requestId) => {
  const state = readState(runId);
  const task = taskFromState(state, requestId);
  if (state.results[requestId]) fail('request_already_processed');
  const input = await rpc(client, 'service_get_refund_scoped_reply_research_input', {
    p_request_id: task.requestId,
    p_claim_token: task.claimToken,
    p_source_message_id: task.sourceMessageId,
    p_expected_fact_version: Number(task.factVersion),
    p_body_sha256: task.bodySha256,
  });
  return validateResearchInput(task, input);
};

export const submitResult = async (client, runId, requestId, proposal) => {
  validateProposalShape(proposal);
  const state = readState(runId);
  const task = taskFromState(state, requestId);
  if (state.results[requestId]) return { outcome: 'already_processed',
    result: state.results[requestId], payloadRedacted: true };
  const input = await getContext(client, runId, requestId);
  let result;
  if (proposal?.kind === 'fact' || proposal?.kind === 'facts') {
    const fact = deriveSourceBoundFacts(input, proposal);
    const current = input.currentFacts ?? {};
    const unchanged = fact.appliedFields.every((field) => field === 'amount'
      ? Number(current.paymentAmountCents) === fact.updates.payment_amount_cents
      : field === 'payment_method'
      ? current.paymentMethod === fact.updates.payment_method
      : field === 'card_network'
      ? current.cardNetwork === fact.updates.card_network
      : current.cardLast4 === fact.updates.card_last4 &&
        current.cardLast4Provenance === fact.updates.card_last4_provenance);
    if (!unchanged) {
      result = await rpc(client, 'service_apply_refund_scoped_reply_semantic_fact', {
        p_request_id: task.requestId,
        p_claim_token: task.claimToken,
        p_source_message_id: task.sourceMessageId,
        p_expected_fact_version: Number(task.factVersion),
        p_body_sha256: task.bodySha256,
        p_field_evidence: fact.fieldEvidence,
        p_updates: fact.updates,
        p_applied_fields: fact.appliedFields,
      });
      if (result?.outcome !== 'applied' && result?.outcome !== 'already_applied') {
        fail('semantic_fact_not_applied');
      }
    }
    if (unchanged) {
      const directionalTime = findKnownFactDirectionalTime(input);
      proposal = directionalTime ? {
        kind: 'reviewed_no_fact',
        reasonCode: 'inexact_purchase_time_requires_research',
        ...directionalTime,
      } : {
        kind: 'reviewed_no_fact', reasonCode: 'no_supported_new_fact',
        messageId: fact.fieldEvidence[0].messageId,
        quote: fact.fieldEvidence[0].quote,
      };
    }
  }
  if (proposal?.kind === 'reviewed_no_fact') {
    const review = validateNoFactReview(input, proposal);
    result = await rpc(client, 'service_complete_refund_scoped_reply_no_fact', {
      p_request_id: task.requestId,
      p_claim_token: task.claimToken,
      p_source_message_id: task.sourceMessageId,
      p_expected_fact_version: Number(task.factVersion),
      p_body_sha256: task.bodySha256,
      p_evidence_message_id: review.evidenceMessageId,
      p_source_quote: review.sourceQuote,
      p_reason_code: review.reasonCode,
    });
    if (result?.outcome !== 'reviewed_no_fact') fail('no_fact_review_not_completed');
  }
  if (proposal?.kind === 'incident_time') {
    const time = validateIncidentTime(input, proposal);
    result = await rpc(client, 'service_apply_refund_scoped_reply_incident_time', {
      p_request_id: task.requestId,
      p_claim_token: task.claimToken,
      p_source_message_id: task.sourceMessageId,
      p_expected_fact_version: Number(task.factVersion),
      p_body_sha256: task.bodySha256,
      p_evidence_message_id: time.evidenceMessageId,
      p_source_quote: time.sourceQuote,
    });
    if (result?.outcome === 'time_requires_research') {
      result = await rpc(client, 'service_defer_refund_scoped_reply_review', {
        p_request_id: task.requestId,
        p_claim_token: task.claimToken,
        p_source_message_id: task.sourceMessageId,
        p_expected_fact_version: Number(task.factVersion),
        p_body_sha256: task.bodySha256,
        p_reason_code: 'research_result_unresolved',
      });
    }
    if (!['applied', 'already_applied', 'deferred'].includes(result?.outcome))
      fail('incident_time_not_applied');
  }
  if (proposal?.kind === 'internal_research') {
    const reasonCode = validateDeferral(proposal);
    result = await rpc(client, 'service_defer_refund_scoped_reply_review', {
      p_request_id: task.requestId,
      p_claim_token: task.claimToken,
      p_source_message_id: task.sourceMessageId,
      p_expected_fact_version: Number(task.factVersion),
      p_body_sha256: task.bodySha256,
      p_reason_code: reasonCode,
    });
    if (result?.outcome !== 'deferred') fail('research_not_deferred');
  }
  if (!result) fail('unsupported_reply_result');
  state.results[requestId] = result.outcome === 'deferred' ? 'deferred' : 'resolved';
  writeState(state);
  return { outcome: state.results[requestId], payloadRedacted: true };
};

export const finishRun = async (client, runId, failureCode = null) => {
  const state = readState(runId);
  const claimed = state.tasks.length;
  const resolved = Object.values(state.results).filter((value) => value === 'resolved').length;
  const deferred = Object.values(state.results).filter((value) => value === 'deferred').length;
  if (resolved + deferred < claimed && !failureCode) fail('unfinished_reply_tasks');
  const receipt = await rpc(client, 'service_finish_refund_reply_subscription_run', {
    p_run_id: runId, p_claimed_count: claimed, p_resolved_count: resolved,
    p_deferred_count: deferred, p_failure_code: failureCode,
  });
  if (receipt?.outcome === 'finished' || receipt?.outcome === 'already_finished') {
    fs.rmSync(safeRunPath(runId), { force: true });
  }
  return { outcome: receipt?.outcome ?? 'unavailable', status: receipt?.status ?? null,
    claimed, resolved, deferred, payloadRedacted: true };
};

const main = async () => {
  const [command, first, second, third] = process.argv.slice(2);
  if (!['begin', 'context', 'submit', 'finish', 'health'].includes(command)) {
    fail('usage: begin | context <run-id> <request-id> | submit <run-id> <request-id> <proposal.json> | finish <run-id> [failure-code] | health');
  }
  const client = createProductionClient();
  let result;
  if (command === 'begin') result = await beginRun(client);
  if (command === 'context') result = await getContext(client, first, second);
  if (command === 'submit') {
    const proposalPath = path.resolve(third ?? '');
    const outputRoot = path.resolve(repoRoot, 'output');
    if (!proposalPath.startsWith(`${outputRoot}${path.sep}`)) fail('proposal_must_be_private_output');
    const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
    result = await submitResult(client, first, second, proposal);
    fs.rmSync(proposalPath, { force: true });
  }
  if (command === 'finish') result = await finishRun(client, first, second ?? null);
  if (command === 'health') result = await rpc(client, 'service_get_refund_reply_subscription_health');
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never print API keys, email bodies, proposal JSON, provider errors or SQL.
    const safe = typeof error?.message === 'string' && /^[a-z0-9_: -]{1,140}$/u.test(error.message)
      ? error.message : 'reply_runner_failed';
    process.stderr.write(`${safe}\n`);
    process.exitCode = 1;
  });
}
