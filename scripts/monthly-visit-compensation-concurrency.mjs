import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

// Only called by the migration validator, against its disposable loopback DB.
export async function verifyMonthlyVisitConcurrency({ dbPort }) {
  assert(Number.isInteger(dbPort) && dbPort > 0 && dbPort <= 65535);
  const config = { host: '127.0.0.1', port: dbPort, database: 'postgres', user: 'postgres', password: 'postgres' };
  const owner = new pg.Client(config), first = new pg.Client(config), second = new pg.Client(config);
  const id = n => `e1416000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const begin = async client => {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','service_role',true)", [id(4)]);
  };
  const waitForLock = async pid => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await owner.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]);
      if (result.rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Monthly compensation transaction did not wait for its source lock');
  };
  const prepare = async client => {
    const request = (await client.query(`insert into public.pay_stub_generation_requests(account_id,operator_profile_id,payout_period_id,trigger_kind,status,requested_by,attempt_count,started_at)
      values($1,$2,$3,'manager_regeneration','processing',$4,1,now()) returning id`, [id(10), id(50), id(80), id(4)])).rows[0].id;
    return (await client.query('select public.service_prepare_pay_stub($1) result', [request])).rows[0].result;
  };
  await Promise.all([owner.connect(), first.connect(), second.connect()]);
  try {
    await begin(owner);
    await owner.query("create function pg_temp.mid(n integer) returns uuid language sql immutable as $$select ('e1416000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$");
    const fixtureUrl = new URL('../supabase/tests/fixtures/monthly_visit_compensation.inc', import.meta.url);
    const fixture = fs.readFileSync(fixtureUrl, 'utf8').replace('\\ir reporting_source_tax.inc', fs.readFileSync(new URL('../supabase/tests/fixtures/reporting_source_tax.inc', import.meta.url), 'utf8'));
    await owner.query(fixture);
    await owner.query('select public.service_refresh_pay_stub_revenue_snapshot($1,$2)', [id(80), id(30)]);
    const agreement = (await owner.query(`select public.admin_save_monthly_visit_agreement(null,$1,$2,'2025-01-01','2025-01-31',18000,3,60,2400,true,null) result`, [id(50), id(30)])).rows[0].result;
    await owner.query('commit');
    const pid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;

    // Preparation and assignment changes cannot straddle one source snapshot.
    await begin(first);
    const prepared = await prepare(first);
    assert.equal(prepared.status, 'prepared');
    await begin(second);
    const assignment = second.query("update public.operator_machine_assignments set effective_start_date='2025-01-02' where id=$1", [id(60)]);
    assignment.catch(() => {});
    await waitForLock(pid);
    await first.query('commit'); await assignment; await second.query('commit');
    await assert.rejects(owner.query('select public.service_complete_pay_stub($1,$2,$3)', [prepared.requestId, prepared.statementId, prepared.storagePath]), /scope changed during generation/);
    await owner.query("update public.operator_machine_assignments set effective_start_date='2020-01-01' where id=$1", [id(60)]);
    await owner.query("update public.pay_stub_generation_requests set status='failed' where id=$1", [prepared.requestId]);

    // Payer correction waits for agreement save, then refuses unreconciled history.
    await begin(first);
    await first.query(`select public.admin_save_monthly_visit_agreement($1,$2,$3,'2025-01-01','2025-01-31',19000,3,60,2400,true,$4)`, [agreement.id, id(50), id(30), agreement.revision]);
    await begin(second);
    const correction = second.query('select private.realign_operator_payroll_profile($1,$2)', [id(50), id(10)]);
    correction.catch(() => {});
    await waitForLock(pid); await first.query('commit');
    await assert.rejects(correction, /Monthly agreement history requires reconciliation/);
    await second.query('rollback');

    // Assignment change first: preparation waits and evaluates the changed scope.
    await begin(first);
    await first.query("update public.operator_machine_assignments set effective_start_date='2025-01-02' where id=$1", [id(60)]);
    await begin(second);
    const preparation = prepare(second);
    preparation.catch(() => {});
    await waitForLock(pid); await first.query('commit');
    const blocked = await preparation;
    assert.notEqual(blocked.status, 'prepared');
    await second.query('rollback');
  } finally {
    await Promise.allSettled([first.query('rollback'), second.query('rollback'), owner.query('rollback')]);
    await Promise.allSettled([first.end(), second.end(), owner.end()]);
  }
}
