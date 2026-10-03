import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

// Only the full migration validator calls this, against its disposable loopback
// PostgreSQL. All exact-production-ID fixtures and mutations roll back.
export async function verifyCompanyPayrollCorrection({ dbPort }) {
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) throw new Error('Disposable database port required');
  const db = new pg.Client({ host: '127.0.0.1', port: dbPort, database: 'postgres', user: 'postgres', password: 'postgres' });
  const correction = fs.readFileSync(new URL('../supabase/migrations/20261003222532_correct_merlin_reporting_company.sql', import.meta.url), 'utf8');
  const source = 'e7205cab-38a4-41c2-b93f-b2b9d0e74754';
  const target = '893c32d0-d81e-482d-b139-2f25ed2668fb';
  const machines = ['32acf22f-0238-465a-a23f-9b43c06e0055','ae3e581a-beec-496d-a7dc-b9b1030a15d0','bda16d19-e27e-4028-9374-300984ce83b7','c7236c42-2812-44f2-8f44-0135104a7b4f','3a9f6131-e420-41e4-a92f-47cd8ad636bc','8fa9b522-b5c6-4880-96a2-55fa1036e6f2'];
  const locations = ['e7f0240a-57a9-40e8-a3f5-8f1cfdaae14e','ff727f67-c1f2-47b2-9d6a-5c232d39f8ee','e946ee16-7de1-49c0-be9a-9dd999240372','cceacdcc-d358-4fe4-a0d0-617f2095e431','f0b1e1a7-cba7-49bb-8649-2df0e234eee3','83f8576b-7f4e-460f-b812-41edf34e21c2'];
  const profiles = ['3b8e9f12-31e9-4ec7-a46e-7957a5b6bd1c','6f95c31a-9923-4971-a0a5-5fe615aad9fa'];
  const assignments = ['c43c30f6-cc37-4dd0-b768-5549b3bab677','78666acd-ffb7-4e01-91f9-0232abc4f792'];
  const grants = ['efaa745f-07b5-4440-a846-4b2efd2cb3db','f563dc9e-2add-482f-b007-aa7bd81ecdc9','92dd8ef3-669f-494e-8499-3fb61f9ad3c5','5a8dcc8f-cae4-460a-9026-0319359ff83b'];
  const admin = 'dd173000-0000-4000-8000-000000000001';
  const users = ['dd173000-0000-4000-8000-000000000002','dd173000-0000-4000-8000-000000000003','dd173000-0000-4000-8000-000000000005','dd173000-0000-4000-8000-000000000006'];
  const outsider = 'dd173000-0000-4000-8000-000000000004';
  const newProfile = 'dd173006-0000-4000-8000-000000000003';
  const policy = 'dd173005-0000-4000-8000-000000000001';
  const period = 'dd173007-0000-4000-8000-000000000001';
  const partner = '866e9e1d-d3f4-429c-bf4c-3ae0fe8c5499';
  const historical = 'dd173009-0000-4000-8000-000000000001';
  const revokedGrants = ['dd173010-0000-4000-8000-000000000001','dd173010-0000-4000-8000-000000000002'];
  let checks = 0;
  async function value(sql, args = []) { return (await db.query(sql, args)).rows[0].result; }
  async function equal(sql, args, expected, label) { assert.deepEqual(await value(sql, args), expected, label); checks++; }
  async function actor(id, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [id, role]);
  }
  async function denied(sql, args, message) {
    await db.query('savepoint expected_denial');
    try {
      await assert.rejects(db.query(sql, args), error => message.test(error.message));
      checks++;
    } finally { await db.query('rollback to savepoint expected_denial'); }
  }
  async function isolated(action) {
    await db.query('savepoint isolated_scenario');
    try { await action(); } finally { await db.query('rollback to savepoint isolated_scenario'); }
  }
  async function reports() {
    const out = [];
    for (const profile of profiles) for (const fn of ['calculate_technician_pay_report','calculate_technician_pay_report_without_tax']) {
      out.push(await value(`select private.${fn}($1,$2,'2026-09-01','2026-09-30') result`, [source, profile]));
    }
    return out;
  }
  async function effectiveTechnicianScopes() {
    const out = [];
    // Exercise the real invite/sponsor/account resolver, but roll back its
    // entitlement upserts so it cannot contaminate preservation fingerprints.
    await isolated(async () => {
      for (const user of [...users,outsider]) {
        await actor(user);
        await db.query("select public.resolve_my_technician_entitlements('Exact correction scope verification')");
        out.push(await value('select public.technician_machine_ids_for_user($1)::text result', [user]));
      }
    });
    return out;
  }
  async function invariants() {
    const out = {};
    for (const table of ['operator_payout_profiles','operator_machine_assignments','payout_policies','compensation_rules','payout_periods','time_entries','machine_sales_facts','reporting_machine_tax_rates','reporting_machine_partnership_assignments','reporting_machine_refund_managers','reporting_machine_entitlements','technician_machine_assignments']) {
      // Transaction fixtures are isolated; hash whole disposable tables to also
      // catch unexpected changes outside the reviewed six-machine scope.
      out[table] = await value(`select md5(coalesce(string_agg(to_jsonb(row)::text,'|' order by to_jsonb(row)::text),'')) result from public.${table} row`);
    }
    out.machineBindings = await value("select md5(string_agg((to_jsonb(m)-'account_id'-'updated_at')::text,'|' order by id)) result from public.reporting_machines m where id=any($1)", [machines]);
    out.venues = await value("select md5(string_agg((to_jsonb(l)-'account_id'-'updated_at')::text,'|' order by id)) result from public.reporting_locations l where id=any($1)", [locations]);
    out.grants = await value("select md5(string_agg((to_jsonb(g)-'account_id'-'updated_at')::text,'|' order by id)) result from public.technician_grants g where id=any($1)", [grants]);
    out.revokedGrants = await value("select md5(string_agg(to_jsonb(g)::text,'|' order by id)) result from public.technician_grants g where id=any($1)", [revokedGrants]);
    return out;
  }
  await db.connect();
  try {
    await db.query('begin');
    // Fail rather than touching an existing identity even on a misconfigured DB.
    await equal('select count(*)::int result from public.customer_accounts where id=any($1)', [[source,target]], 0, 'exact fixtures absent in disposable database');
    await db.query('set local session_replication_role=replica');
    for (const [i,id] of [admin,...users,outsider].entries()) await db.query('insert into auth.users(id,email) values($1,$2)', [id, `correction-${i}@example.invalid`]);
    await db.query("insert into public.admin_roles(user_id,role,active) values($1,'super_admin',true)", [admin]);
    await db.query("insert into public.customer_accounts(id,name,account_type) values($1,'Merlin Entertainments','partner'),($2,'Bloomjoy Enterprises','customer')", [source,target]);
    await db.query("insert into public.reporting_partnerships(id,name,effective_start_date,status) values($1,'Merlin Revenue Share','2026-01-01','active')", [partner]);
    for (let i=0;i<6;i++) {
      await db.query('insert into public.reporting_locations(id,account_id,name,timezone) values($1,$2,$3,$4)', [locations[i],source,`Preserved venue ${i}`,i<4?'America/Los_Angeles':'America/Chicago']);
      await db.query("insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,sunze_machine_id) values($1,$2,$3,$4,'commercial',$5)", [machines[i],source,locations[i],`Preserved machine ${i}`,`1730-source-${i}`]);
      await db.query("insert into public.reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date) values($1,$2,'2026-01-01')", [machines[i],partner]);
      await db.query("insert into public.reporting_machine_tax_rates(machine_id,tax_rate_percent,effective_start_date,status) values($1,0,'2026-01-01','active')", [machines[i]]);
      await db.query("insert into public.machine_sales_facts(reporting_machine_id,reporting_location_id,sale_date,payment_method,net_sales_cents,transaction_count,source,source_row_hash) values($1,$2,'2026-09-15','cash',$3,1,'sample_seed',$4)", [machines[i],locations[i],(i+1)*1000,`1730-correction-sale-${i}`]);
      await db.query('insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email) values($1,$2,$3)', [machines[i],admin,'correction-0@example.invalid']);
      await db.query("insert into public.reporting_machine_entitlements(machine_id,user_id,starts_at) values($1,$2,'2020-01-01')", [machines[i],outsider]);
    }
    await db.query("insert into public.payout_policies(id,account_id,name,frequency,period_anchor_type,monthly_period_type,submission_due_offset_days,lock_offset_days,target_payout_offset_days,rounding_rule,review_model) values($1,$2,'Preserved policy','monthly','calendar','calendar_month',4,4,5,'round_up_60_minutes','no_review_required')", [policy,source]);
    await db.query('update public.customer_accounts set default_payout_policy_id=$1 where id=$2', [policy,source]);
    for (let i=0;i<2;i++) {
      await db.query("insert into public.operator_payout_profiles(id,account_id,user_id,display_name,worker_type,payout_policy_id) values($1,$2,$3,$4,'contractor_1099',$5)", [profiles[i],source,users[i],`Preserved operator ${i}`,policy]);
      await db.query("insert into public.operator_machine_assignments(id,operator_profile_id,account_id,reporting_machine_id,effective_start_date,grant_reason) values($1,$2,$3,$4,'2026-09-01','Reviewed assignment')", [assignments[i],profiles[i],source,machines[i]]);
      await db.query("insert into public.compensation_rules(account_id,operator_profile_id,reporting_machine_id,hourly_rate_cents,shift_rate_cents,effective_start_date,status) values($1,$2,$3,2000,2000,'2026-09-01','active')", [source,profiles[i],machines[i]]);
      await db.query("insert into public.compensation_rules(account_id,operator_profile_id,reporting_machine_id,commission_basis_points,effective_start_date,status) values($1,$2,$3,1000,'2026-09-01','active')", [source,profiles[i],machines[i]]);
    }
    await db.query("insert into public.operator_payout_profiles(id,account_id,user_id,display_name,worker_type,payout_policy_id) values($1,$2,$3,'Unretained profile','contractor_1099',$4)", [newProfile,source,outsider,policy]);
    await db.query("insert into public.payout_periods(id,account_id,payout_policy_id,period_start_date,period_end_date,submission_due_date,lock_date,target_payout_date,status) values($1,$2,$3,'2026-09-01','2026-09-30','2026-10-04','2026-10-04','2026-10-05','locked')", [period,source,policy]);
    await db.query("insert into public.time_entries(id,account_id,operator_profile_id,reporting_machine_id,reporting_location_id,payout_policy_id,payout_period_id,work_date,start_time,end_time,actual_start_at,actual_end_at,raw_duration_minutes,rounded_paid_minutes,paid_shift_count,status) values($1,$2,$3,$4,$5,$6,$7,'2026-09-15','08:00','08:20','2026-09-15 15:00+00','2026-09-15 15:20+00',20,60,1,'submitted')", [historical,source,profiles[0],machines[0],locations[0],policy,period]);
    for (let i=0;i<4;i++) {
      await db.query("insert into public.technician_grants(id,account_id,sponsor_user_id,technician_email,technician_user_id,status,starts_at) values($1,$2,$3,$4,$5,'active','2020-01-01')", [grants[i],source,admin,`correction-${i+1}@example.invalid`,users[i]]);
      await db.query("insert into public.technician_machine_assignments(technician_grant_id,machine_id,starts_at) values($1,$2,'2020-01-01')", [grants[i],machines[i]]);
    }
    for (let i=0;i<2;i++) {
      await db.query("insert into public.technician_grants(id,account_id,sponsor_user_id,technician_email,technician_user_id,status,starts_at,revoked_at,revoke_reason) values($1,$2,$3,$4,$5,'revoked','2020-01-01',now(),'Original reviewed revoked grant')", [revokedGrants[i],source,admin,`revoked-grant-${i}@example.invalid`,outsider]);
      await db.query("insert into public.technician_machine_assignments(technician_grant_id,machine_id,starts_at,status,revoked_at,revoke_reason) values($1,$2,'2020-01-01','revoked',now(),'Original reviewed revoked assignment')", [revokedGrants[i],machines[4+i]]);
    }
    await db.query('set local session_replication_role=origin');
    await actor(admin);
    for (let i=0;i<2;i++) await db.query('select public.admin_generate_payout_revenue_snapshot_without_tax($1,$2,false,$3)', [period,machines[i],'Correction baseline']);
    const before = await invariants();
    const beforeReports = await reports();
    const beforeEffective = await effectiveTechnicianScopes();
    const technicianScope = await value('select array_agg(machine_id order by machine_id)::text result from public.technician_machine_assignments where technician_grant_id=any($1)', [grants]);

    // Drift must fail before any ownership or access mutation.
    for (const drift of [
      () => db.query("insert into public.customer_account_memberships(account_id,user_id,email,role,active) values($1,$2,'drift@example.invalid','owner',true)", [source,outsider]),
      () => db.query("insert into public.technician_grants(account_id,sponsor_user_id,technician_email,status) values($1,$2,'unreviewed@example.invalid','active')", [source,admin]),
      () => db.query("insert into public.operator_machine_assignments(operator_profile_id,account_id,reporting_machine_id,effective_start_date,grant_reason) values($1,$2,$3,'2026-09-01','Unreviewed dependency')", [newProfile,source,machines[2]]),
      () => db.query('delete from public.reporting_machine_partnership_assignments where machine_id=$1', [machines[5]]),
    ]) await isolated(async () => { await drift(); await denied(correction, [], /reviewed.*changed/); });

    await db.query(correction);
    assert.deepEqual(await invariants(), before, 'correction preserves financial/policy/rate/time/access/provider/venue hashes'); checks++;
    assert.deepEqual(await reports(), beforeReports, 'both retained profiles preserve full and without-tax pay calculations'); checks++;
    const afterEffective = await effectiveTechnicianScopes();
    assert.deepEqual(afterEffective, beforeEffective, 'actual technician resolver preserves active scopes and zero revoked access'); checks++;
    await equal('select count(*)::int result from public.reporting_machines where id=any($1) and account_id=$2', [machines,target], 6, 'all six canonical machines transferred');
    await equal('select count(*)::int result from public.reporting_locations where id=any($1) and account_id=$2', [locations,target], 6, 'all six venue identities retained');
    await equal('select count(*)::int result from public.technician_grants where id=any($1) and account_id=$2', [grants,target], 4, 'four reviewed grants retain exact authority under corrected company');
    await equal('select array_agg(machine_id order by machine_id)::text result from public.technician_machine_assignments where technician_grant_id=any($1)', [grants], technicianScope, 'technician explicit machine scope unchanged');
    await equal("select reporting_archived_at is not null and status='active' result from public.customer_accounts where id=$1", [source], true, 'retired company archived without access/status mutation');
    await equal('select count(*)::int result from private.reporting_company_payroll_compatibility', [], 2, 'exact two audited original payroll pairs');
    const audits = await value("select count(*)::int result from public.admin_audit_log where meta->>'migration'='20261003222532'");
    await db.query(correction);
    await equal("select count(*)::int result from public.admin_audit_log where meta->>'migration'='20261003222532'", [], audits, 'replay creates no duplicate correction audits');
    for (let i=0;i<2;i++) await equal('select private.reporting_company_payroll_machine_matches($1,$2,$3) result', [source,machines[i],profiles[i]], true, 'exact original payroll pair remains valid');
    await equal('select private.reporting_company_payroll_machine_matches($1,$2,$3) result', [source,machines[0],newProfile], false, 'new profile cannot inherit retained machine');
    await equal('select private.reporting_company_payroll_machine_matches($1,$2) result', [source,machines[2]], false, 'account-wide snapshot cannot include another Enterprise machine');
    for (let i=0;i<2;i++) await db.query('select public.admin_generate_payout_revenue_snapshot_without_tax($1,$2,true,$3)', [period,machines[i],'Correction regenerate']);
    assert.deepEqual(await reports(), beforeReports, 'source-regenerated snapshots retain original pay results'); checks++;
    await actor(admin, 'service_role');
    for (let i=0;i<2;i++) await db.query('select public.service_refresh_pay_stub_revenue_snapshot($1,$2)', [period,machines[i]]);
    assert.deepEqual(await reports(), beforeReports, 'published Pay Stub refresh chain retains original pay results'); checks++;
    await denied('select public.service_refresh_pay_stub_revenue_snapshot($1,$2)', [period,machines[2]], /scope not found/);
    await actor(admin);
    await denied('select public.admin_generate_payout_revenue_snapshot_without_tax($1,$2,false,$3)', [period,machines[2],'Forbidden widened snapshot'], /not found for payout account/);
    await denied('select public.admin_override_payout_revenue_snapshot($1,$2,1000,0,$3)', [period,machines[2],'Forbidden widened override'], /not found for payout account/);

    await isolated(async () => {
      // Existing UI supersede closes old rate and creates a dated replacement.
      const rule = await value("select id::text result from public.compensation_rules where operator_profile_id=$1 and shift_rate_cents is not null", [profiles[0]]);
      await db.query("select public.admin_upsert_operator_compensation_rate($1,$2,$3,$4,'shift',2100,'2026-09-01',null,'active','Existing retained rate edit')", [rule,source,profiles[0],machines[0]]); checks++;
      await db.query("select public.admin_supersede_operator_compensation_rate($1,$2,$3,'shift',2300,'2026-10-01',null,'Retained future rate')", [source,profiles[0],machines[0]]); checks++;
      await equal("select effective_end_date::text result from public.compensation_rules where id=$1", [rule], '2026-09-30', 'existing rate history closes at prior date');
      await equal("select count(*)::int result from public.compensation_rules where operator_profile_id=$1 and reporting_machine_id=$2 and shift_rate_cents=2300 and effective_start_date='2026-10-01'", [profiles[0],machines[0]], 1, 'future same-pair rate survives ownership correction');
      await db.query("select public.admin_upsert_operator_compensation_rule(null,$1,$2,$3,2200,null,'2026-11-01',null,'inactive',null,'Retained generic rate edit')", [source,profiles[1],machines[1]]); checks++;
      await denied("select public.admin_upsert_operator_compensation_rule(null,$1,null,$2,2200,null,'2026-11-01',null,'active',null,'No broad machine-only rate')", [source,machines[0]], /Reporting machine not found/);
      await denied("select public.admin_upsert_operator_compensation_rate(null,$1,$2,$3,'shift',2200,'2026-11-01',null,'active',null)", [source,newProfile,machines[0]], /Reporting machine not found/);
      await denied("select public.admin_upsert_operator_compensation_rate(null,$1,$2,$3,'shift',2200,'2026-11-01',null,'active',null)", [source,profiles[0],machines[2]], /Reporting machine not found/);
      await actor(outsider);
      await denied("select public.admin_upsert_operator_compensation_rate(null,$1,$2,$3,'shift',2200,'2026-11-01',null,'active',null)", [source,profiles[0],machines[0]], /compensation access required/);
      await actor(admin);
    });

    await isolated(async () => {
      await db.query("select public.admin_upsert_operator_machine_assignment($1,$2,$3,'2026-09-01','2026-12-31')", [assignments[0],profiles[0],machines[0]]); checks++;
      await equal('select effective_end_date::text result from public.operator_machine_assignments where id=$1', [assignments[0]], '2026-12-31', 'existing original assignment can be closed with end date');
      await denied("select public.admin_upsert_operator_machine_assignment(null,$1,$2,'2027-01-01',null)", [profiles[0],machines[0]], /must belong to the same account/);
      await denied("select public.admin_upsert_operator_machine_assignment($1,$2,$3,'2026-09-01',null)", [assignments[0],profiles[0],machines[2]], /must belong to the same account/);
      await db.query('select public.admin_set_operator_machine_assignments($1,$2,$3)', [profiles[1],[machines[1]],'Keep exact retained assignment']); checks++;
      await db.query('select public.admin_set_operator_machine_assignments($1,$2,$3)', [profiles[1],[],'Revoke exact retained assignment']); checks++;
      await equal("select status='revoked' and revoked_at is not null result from public.operator_machine_assignments where id=$1", [assignments[1]], true, 'existing bulk revocation still works');
      await denied('select public.admin_set_operator_machine_assignments($1,$2,$3)', [profiles[1],[machines[1]],'Do not create new retained ID'], /Every assigned machine must exist/);
      await equal('select count(*)::int result from public.operator_machine_assignments where operator_profile_id=$1', [profiles[1]], 1, 'revocation cannot be bypassed with a new assignment ID');
      await db.query("select public.admin_upsert_operator_machine_assignment($1,$2,$3,'2026-09-01',null)", [assignments[1],profiles[1],machines[1]]); checks++;
      await equal("select status='active' and revoked_at is null result from public.operator_machine_assignments where id=$1", [assignments[1]], true, 'authorized manager can explicitly reinstate the SAME original assignment ID');
    });

    const workDate = await value("select ((now() at time zone 'America/Los_Angeles')::date-1)::text result");
    async function save(profile, machine, hour = '10:00', id = null) {
      return db.query("select public.save_operator_time_entry($1,$2,$3,($4::date+$5::time) at time zone 'America/Los_Angeles',($4::date+$5::time+interval '20 minutes') at time zone 'America/Los_Angeles','Preserved timekeeping')", [id,profile,machine,workDate,hour]);
    }
    await isolated(async () => {
      for (let i=0;i<2;i++) { await actor(users[i]); await save(profiles[i],machines[i]); checks++; }
      await equal('select count(*)::int result from public.time_entries where work_date=$1 and account_id=$2 and payout_policy_id=$3', [workDate,source,policy], 2, 'both future entries retain original payroll account and policy');
      await actor(users[0]);
      await denied("select public.submit_operator_time_entry($1,$2,$3,'11:00','11:20',null,'submitted')", [profiles[0],machines[2],workDate], /Assigned machine not found/);
      await db.query("select public.submit_operator_time_entry($1,$2,$3,'11:00','11:20',null,'submitted')", [profiles[0],machines[0],workDate]); checks++;
      await actor(admin);
      await db.query("select public.manager_correct_operator_time_entry($1,$2,'2026-09-15 15:00+00','2026-09-15 15:30+00','Preserved historical correction',false)", [historical,machines[0]]); checks++;
      await equal('select account_id=$1 and payout_policy_id=$2 and payout_period_id=$3 result from public.time_entries where id=$4', [source,policy,period,historical], true, 'historical manager edit retains original pay policy/account/period');
      await db.query("select public.manager_create_operator_time_entry($1,$2,'2026-09-16 15:00+00','2026-09-16 15:20+00','Preserved manager missed entry')", [profiles[1],machines[1]]); checks++;
      const historicBefore = await value("select private.calculate_technician_pay_report($1,$2,'2026-09-01','2026-09-30') result", [source,profiles[0]]);
      for (const change of [
        () => db.query("update public.operator_machine_assignments set status='revoked',revoked_at=now(),revoke_reason='Synthetic revocation' where id=$1", [assignments[0]]),
        () => db.query('update public.operator_machine_assignments set effective_end_date=$1::date-1 where id=$2', [workDate,assignments[0]]),
      ]) await isolated(async () => {
        await change(); await actor(users[0]);
        await denied("select public.save_operator_time_entry(null,$1,$2,($3::date+time '12:00') at time zone 'America/Los_Angeles',($3::date+time '12:20') at time zone 'America/Los_Angeles',null)", [profiles[0],machines[0],workDate], /effective.*assignment|assigned.*machine/i);
        await denied("select public.submit_operator_time_entry($1,$2,$3,'12:00','12:20',null,'submitted')", [profiles[0],machines[0],workDate], /effective.*assignment|assigned.*machine/i);
        await actor(admin);
        const historicalAfter = await value("select private.calculate_technician_pay_report($1,$2,'2026-09-01','2026-09-30') result", [source,profiles[0]]);
        assert.deepEqual(historicalAfter, historicBefore, 'revoked/expired fresh authority still preserves historical pay calculation'); checks++;
        await db.query("select public.admin_upsert_operator_machine_assignment($1,$2,$3,'2026-09-01',null)", [assignments[0],profiles[0],machines[0]]);
        await actor(users[0]);
        await save(profiles[0],machines[0],'12:00'); checks++;
        await actor(admin);
      });
      await actor(admin);
    });
    assert.deepEqual(await invariants(), before, 'all workflow proofs roll back; original financial and payroll records remain exact'); checks++;
    console.log(`Company ownership correction and retained payroll compatibility: ${checks} checks passed, all synthetic fixtures rolled back.`);
  } finally { await db.query('rollback').catch(() => {}); await db.end(); }
}
