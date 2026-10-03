import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

// Called only by the full migration replay against its disposable loopback DB.
export async function verifyCompanyAssignmentConcurrency({ dbPort }) {
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) throw new Error('Disposable database port required');
  const config = { host: '127.0.0.1', port: dbPort, database: 'postgres', user: 'postgres', password: 'postgres' };
  const owner = new pg.Client(config);
  const first = new pg.Client(config);
  const second = new pg.Client(config);
  const actor = crypto.randomUUID();
  const machine = crypto.randomUUID();
  const suffix = crypto.randomUUID();
  const name = `Concurrent company ${suffix}`;
  let companyIds = [];
  const querySave = `select (public.admin_upsert_reporting_machine_by_id($1,$2,$3,'Concurrent machine','snapcase',null,
    'live','Synthetic concurrency verification',$4,$5)).id`;
  async function beginActor(client) {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [actor]);
    await client.query('set local role authenticated');
  }
  async function waitForLock(pid) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const state = await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [pid]);
      if (state.rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Second transaction did not wait on the expected concurrency guard');
  }
  await owner.connect();
  await first.connect();
  await second.connect();
  try {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [actor, `company-race-${suffix}@example.invalid`]);
    await owner.query("insert into public.admin_roles(user_id,role,active) values($1,'super_admin',true)", [actor]);
    const accessBaseline = await owner.query('select (select count(*) from public.customer_account_memberships) memberships,(select count(*) from public.customer_account_invites) invites');
    await beginActor(first);
    const created = (await first.query('select public.admin_create_reporting_company($1) result', [` ${name} `])).rows[0].result;
    companyIds.push(created.accountId);
    await beginActor(second);
    const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
    const duplicatePromise = second.query('select public.admin_create_reporting_company($1) result', [name.toUpperCase()]);
    // Install an immediate rejection handler while waiting for lock evidence.
    duplicatePromise.catch(() => {});
    await waitForLock(secondPid);
    await first.query('commit');
    const duplicate = (await duplicatePromise).rows[0].result;
    await second.query('commit');
    assert.equal(created.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.accountId, created.accountId);
    const count = await owner.query('select count(*)::int n from public.customer_accounts where lower(btrim(name))=lower($1)', [name]);
    assert.equal(count.rows[0].n, 1);
    const afterAccess = await owner.query('select (select count(*) from public.customer_account_memberships) memberships,(select count(*) from public.customer_account_invites) invites');
    assert.deepEqual(afterAccess.rows, accessBaseline.rows);

    await beginActor(first);
    const target = (await first.query('select public.admin_create_reporting_company($1) result', [`Target ${name}`])).rows[0].result;
    companyIds.push(target.accountId);
    await first.query('commit');
    const oldLocation = crypto.randomUUID();
    const targetLocation = crypto.randomUUID();
    await owner.query("insert into public.reporting_locations(id,account_id,name,timezone) values($1,$2,'Original','America/Chicago'),($3,$4,'Target','America/New_York')", [oldLocation, created.accountId, targetLocation, target.accountId]);
    await owner.query("insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type) values($1,$2,$3,'Concurrent machine','snapcase')", [machine, created.accountId, oldLocation]);
    await beginActor(first);
    await first.query(querySave, [machine, target.accountId, targetLocation, created.accountId, oldLocation]);
    await beginActor(second);
    const stalePromise = second.query(querySave, [machine, created.accountId, oldLocation, created.accountId, oldLocation]);
    stalePromise.catch(() => {});
    await waitForLock(secondPid);
    await first.query('commit');
    await assert.rejects(stalePromise, { code: '40001' });
    await second.query('rollback');
    const saved = (await owner.query('select account_id,location_id from public.reporting_machines where id=$1', [machine])).rows[0];
    assert.equal(saved.account_id, target.accountId);
    assert.equal(saved.location_id, targetLocation);
    return { duplicateCreates: 'same canonical ID', staleAssignment: 'rejected', invitationsAndMemberships: 'unchanged' };
  } finally {
    await first.query('rollback').catch(() => {});
    await second.query('rollback').catch(() => {});
    await owner.query('delete from public.reporting_machines where id=$1', [machine]);
    await owner.query('delete from public.customer_accounts where id=any($1::uuid[])', [companyIds]);
    await owner.query('delete from public.admin_audit_log where actor_user_id=$1', [actor]);
    await owner.query('delete from auth.users where id=$1', [actor]);
    await Promise.all([owner.end(), first.end(), second.end()]);
  }
}
