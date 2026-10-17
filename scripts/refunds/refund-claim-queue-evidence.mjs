import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const caseId = 'b3470000-0000-4000-8000-000000000001';
const account = 'SINGLE_GATE_RACE_ACCOUNT';
const executor = 'single-gate-race-executor';
const claimSql = "select public.service_claim_due_nayax_refund_attempts_v1($1,$2,'exact_source','empty_string',1) result";
const signature = 'public.service_claim_due_nayax_refund_attempts_v1(text,text,text,text,integer)';

export function extractClaimSelect(definition) {
  const match = definition.match(/for a in\s+([\s\S]*?)\s+loop/iu);
  assert(match, 'Exact claim SELECT boundary must exist');
  return match[1].trim();
}

// Reconstruct the prior canonical SELECT from the reviewed explicit definition
// and its original-reader patch, rather than maintaining a different old query.
export function priorClaimSelect() {
  const source = read('../../supabase/migrations/20260919182610_refund_machine_processor_hold.sql');
  let query = extractClaimSelect(source.slice(source.indexOf('create or replace function public.service_claim_due_nayax_refund_attempts_v1(')));
  assert.equal((query.match(/machine\.nayax_account_key/gu) ?? []).length, 3);
  assert.equal((query.match(/machine\.nayax_machine_id/gu) ?? []).length, 2);
  const identity = 'public.service_refund_case_reader_identity(refund_case.id,machine.id)';
  query = query.replaceAll('machine.nayax_account_key', `(${identity}->>'accountKey')`)
    .replaceAll('machine.nayax_machine_id', `(${identity}->>'readerId')`);
  return query;
}

export function bindClaimSelect(query) {
  return query.replace(/\bp_account_key\b/gu, '$1')
    .replace(/\bp_serialization_mode\b/gu, '$2')
    .replace(/\bp_refund_email_list_mode\b/gu, '$3')
    .replace(/\bp_limit\b/gu, '$4');
}

export function raceFixture() {
  const source = read('../../supabase/tests/refund_single_manager_gate_concurrency.sql');
  const setupEnd = source.indexOf('\nselect plan(10);');
  const cleanupStart = source.indexOf('-- The committed fixture exists only');
  assert(setupEnd > 0 && cleanupStart > setupEnd, 'Existing real approval fixture boundaries must remain exact');
  // The existing race's case-update sleep is unrelated to this queue test.
  const setup = source.slice(0, setupEnd).replace(/create function refund_single_gate_race\.delay_case_update\(\)[\s\S]*?execute function refund_single_gate_race\.delay_case_update\(\);/u, '');
  return { setup, cleanup: source.slice(cleanupStart) };
}

const statCalls = async client => Number((await client.query(`select coalesce((select calls
  from pg_stat_xact_user_functions where funcid='public.service_refund_case_reader_identity(uuid,uuid)'::regprocedure),0) calls`)).rows[0].calls);

async function measure(client, query) {
  const params = [account, 'exact_source', 'empty_string', 1];
  const before = await statCalls(client);
  const plan = (await client.query(`explain (analyze,buffers,format json) ${bindClaimSelect(query)}`, params)).rows[0]['QUERY PLAN'][0];
  const helperCalls = await statCalls(client) - before;
  const rows = (await client.query(bindClaimSelect(query), params)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].refund_case_id, caseId);
  return { helperCalls, executionMs: plan['Execution Time'], plan };
}

// All cloning is confined to this disposable fixture transaction. Runtime
// selection and claims run with every production trigger and the real helper.
async function noise(client, first, last) {
  await client.query('set local session_replication_role=replica');
  await client.query(`do $$ begin for n in ${first}..${last} loop
    perform refund_single_gate_race.clone_held_case(
      ('d6610000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('d6620000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('d6630000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('d6640000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('d6650000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      'RF-CLAIM-NOISE-'||n,'CLAIM-NOISE-SALE-'||n,
      'claim-noise-'||n||'@example.invalid',n*interval '1 minute');
  end loop; end $$;
  update public.refund_case_nayax_refund_attempts set status='manual_review',
    provider_claim_digest=repeat('0',64),provider_claim_expires_at=now()-interval '1 hour',
    provider_outcome='unknown',provider_outcome_recorded_at=now(),reconciliation_required=true,
    safe_transport_stage='confirmation_hold'
    where refund_case_id::text like 'd6610000-%';
  update public.refund_cases set status='needs_review',decision=null
    where id::text like 'd6610000-%' and right(id::text,1) not in ('0','5');`);
  await client.query('set local session_replication_role=origin');
  await client.query('analyze public.refund_case_nayax_refund_attempts; analyze public.refund_cases; analyze public.refund_nayax_execution_contexts; analyze public.refund_case_official_action_authorizations');
}

async function assertHeldFirst(client) {
  await client.query('savepoint held_first');
  await client.query(`set local session_replication_role=replica;
    select refund_single_gate_race.clone_held_case(
      'b3470000-0000-4000-8000-000000000002','b34a0000-0000-4000-8000-000000000002',
      'b34b0000-0000-4000-8000-000000000002','b34c0000-0000-4000-8000-000000000002',
      'b3490000-0000-4000-8000-000000000002','RF-CLAIM-HELD-FIRST','CLAIM-HELD-FIRST',
      'claim-held-first@example.invalid','-2 days');
    update public.refund_case_nayax_refund_attempts set created_at=now()-interval '1 day'
      where refund_case_id='b3470000-0000-4000-8000-000000000002';
    update public.refund_nayax_execution_contexts set context=jsonb_set(context,'{providerMachineId}','"DIFFERENT-READER"')
      where refund_case_id='b3470000-0000-4000-8000-000000000002';
    set local session_replication_role=origin;`);
  const result = (await client.query(claimSql, [executor, account])).rows[0].result;
  assert.equal(result.claims.length, 1, 'An identity-held first row must not starve a later eligible row');
  assert.equal(result.claims[0].providerWireContext.caseId, caseId);
  assert.equal(result.claims[0].providerWireContext.refundAmountCents, 500);
  assert.equal(result.claims[0].providerWireContext.originalAmountCents, 1090);
  assert.equal(Number((await client.query('select count(*) n from public.refund_nayax_provider_stage_journal')).rows[0].n), 0);
  await client.query('rollback to savepoint held_first');
  const other = (await client.query(claimSql, [executor, 'OTHER_ACCOUNT'])).rows[0].result;
  assert.equal(other.claims.length, 0, 'Another account cannot claim this frozen approval');
}

async function staleSnapshotRace(config, owner) {
  const first = new pg.Client(config), stale = new pg.Client(config);
  const original = (await owner.query("select pg_get_functiondef('public.service_refund_case_reader_identity(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  let pending;
  await Promise.all([first.connect(), stale.connect()]);
  try {
    // Delay only this separate concurrency probe, after the real-helper plans.
    // The wrapper delegates unchanged identity checks to the captured real body.
    await owner.query(original.replace('public.service_refund_case_reader_identity(', 'refund_single_gate_race.real_reader_identity('));
    await owner.query(`create or replace function public.service_refund_case_reader_identity(p_case_id uuid,p_machine_id uuid)
      returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
      if current_setting('test.refund_claim_pause',true)='true' then
        perform pg_catalog.pg_advisory_xact_lock(1966,1);
      end if;
      return refund_single_gate_race.real_reader_identity(p_case_id,p_machine_id);
      end $$;`);
    await owner.query('begin; select pg_advisory_xact_lock(1966,1)');
    await stale.query("begin; select set_config('test.refund_claim_pause','true',true)");
    const pid = (await stale.query('select pg_backend_pid() pid')).rows[0].pid;
    pending = stale.query(claimSql, [executor, account]);
    pending.catch(() => {});
    let paused = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = (await owner.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1', [pid])).rows[0];
      if (state?.wait_event_type === 'Lock' && state.wait_event === 'advisory') { paused = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(paused, 'Claim must pause after its eligible snapshot and before its outer tuple lock');
    await first.query('begin');
    const winner = (await first.query(claimSql, [executor, account])).rows[0].result;
    assert.equal(winner.claims.length, 1);
    await first.query('commit');
    const digest = (await first.query('select provider_claim_digest from public.refund_case_nayax_refund_attempts where refund_case_id=$1', [caseId])).rows[0].provider_claim_digest;
    await owner.query('commit');
    const loser = (await pending).rows[0].result;
    assert.equal(loser.claims.length, 0, 'EPQ must reject the now-in-progress attempt from the stale materialized snapshot');
    await stale.query('commit');
    assert.equal((await owner.query('select provider_claim_digest from public.refund_case_nayax_refund_attempts where refund_case_id=$1', [caseId])).rows[0].provider_claim_digest, digest);
    return { commitBetweenSnapshotAndLock: 'passed', claimWinners: 1, providerCalls: 0 };
  } finally {
    await owner.query('rollback');
    await pending?.catch(() => {});
    await Promise.allSettled([first.query('rollback'), stale.query('rollback')]);
    await owner.query(original);
    await Promise.allSettled([first.end(), stale.end()]);
  }
}

// Invoked only by the disposable migration validator. No production URL, token,
// provider adapter, or remotely addressable database is accepted here.
export async function verifyRefundClaimQueue({ dbPort }) {
  assert(Number.isInteger(dbPort) && dbPort > 0 && dbPort <= 65535);
  const config = { host: '127.0.0.1', port: dbPort, database: 'postgres', user: 'postgres', password: 'postgres' };
  const client = new pg.Client(config);
  const fixture = raceFixture();
  const evidence = { schemaVersion: 'refund-claim-queue-evidence-v1', syntheticOnly: true, completed: false, samples: [] };
  let installed = false;
  await client.connect();
  try {
    await client.query(fixture.setup);
    installed = true;
    await client.query(`begin;
      select set_config('request.jwt.claim.sub','b3410000-0000-4000-8000-000000000001',true),
        set_config('request.jwt.claim.role','authenticated',true),
        set_config('request.jwt.claims','{"sub":"b3410000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
      select public.admin_approve_selected_nayax_refund_for_system_v2('${caseId}',
        (select official_action_version from public.refund_cases where id='${caseId}'),500);
      commit;`);
    const definition = (await client.query('select pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition;
    const candidate = extractClaimSelect(definition);
    assert.equal((candidate.match(/public\.service_refund_case_reader_identity\(/gu) ?? []).length, 1);
    await client.query("begin; set local track_functions='pl'");
    for (const [first, last] of [[1, 100], [101, 1000]]) {
      await noise(client, first, last);
      const old = await measure(client, priorClaimSelect());
      const current = await measure(client, candidate);
      assert.equal(current.helperCalls, 1, 'Only the one cheaply eligible attempt resolves its real reader identity');
      assert(old.helperCalls > current.helperCalls, 'Synthetic query must demonstrate reduced real helper calls');
      evidence.samples.push({ unrelatedAttempts: last, createdEligibleAttempts: 1, old, current });
    }
    await assertHeldFirst(client);
    await client.query('rollback');
    evidence.concurrency = await staleSnapshotRace(config, client);
    evidence.completed = true;
    console.log('Refund claim synthetic evidence:', JSON.stringify({
      samples: evidence.samples.map(({ unrelatedAttempts, old, current }) => ({ unrelatedAttempts,
        oldHelperCalls: old.helperCalls, currentHelperCalls: current.helperCalls,
        oldMs: old.executionMs, currentMs: current.executionMs })), concurrency: evidence.concurrency,
    }));
    return evidence;
  } finally {
    if (evidence.samples.length > 0) {
      const directory = new URL('../../output/', import.meta.url);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(new URL('refund-claim-queue-evidence.json', directory), `${JSON.stringify(evidence, null, 2)}\n`);
    }
    await client.query('rollback');
    if (installed) await client.query(fixture.cleanup);
    await client.end();
  }
}
