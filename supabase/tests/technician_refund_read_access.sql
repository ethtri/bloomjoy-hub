begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic records only. Avoid customer automation/outbox side effects.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('e9710000-0000-4000-8000-000000000001','read-manager@example.invalid'),
 ('e9710000-0000-4000-8000-000000000002','read-tech@example.invalid'),
 ('e9710000-0000-4000-8000-000000000003','read-sales@example.invalid');
insert into public.customer_accounts(id,name,account_type) values
 ('e9720000-0000-4000-8000-000000000001','Read fixture company','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('e9730000-0000-4000-8000-000000000001','e9720000-0000-4000-8000-000000000001','West','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 select ('e9740000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e9720000-0000-4000-8000-000000000001',
 'e9730000-0000-4000-8000-000000000001','Machine '||n,'active' from generate_series(1,3) n;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status) values
 ('e9740000-0000-4000-8000-000000000001','e9710000-0000-4000-8000-000000000001','read-manager@example.invalid','active'),
 ('e9740000-0000-4000-8000-000000000002','e9710000-0000-4000-8000-000000000002','read-tech@example.invalid','active');
insert into public.technician_grants(id,account_id,sponsor_user_id,technician_email,technician_user_id,status,starts_at,grant_reason) values
 ('e9750000-0000-4000-8000-000000000001','e9720000-0000-4000-8000-000000000001','e9710000-0000-4000-8000-000000000001',
 'read-tech@example.invalid','e9710000-0000-4000-8000-000000000002','active','2020-01-01','Synthetic read test');
insert into public.technician_machine_assignments(technician_grant_id,machine_id,status,starts_at,grant_reason) values
 ('e9750000-0000-4000-8000-000000000001','e9740000-0000-4000-8000-000000000001','active','2020-01-01','Synthetic read test');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('e9710000-0000-4000-8000-000000000003','e9740000-0000-4000-8000-000000000001','2020-01-01');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
 customer_name,customer_phone,zelle_payment_contact,card_last4,issue_summary,issue_category,incident_at,payment_method,
 payment_amount_cents,refund_amount_cents,status,customer_request_received_at,customer_request_received_source)
 select ('e9760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-READ-'||n,
 ('e9740000-0000-4000-8000-'||lpad((case when n=4 then 2 when n=5 then 3 else 1 end)::text,12,'0'))::uuid,
 'e9730000-0000-4000-8000-000000000001','person@example.invalid','Jane Smith','555-333-4444','@secret-pay','1234',
 'The motor pauses after 12 seconds. 糖卡住了. Error code E05, spinner stopped. Could spin 12 seconds before the pinion gear stopped. Contact jane smith person@example.invalid 555-333-4444. Card ending 1234. Gift code SECRET123. 123 Private Street. Zelle @secret-pay. CVV 987. Password is HIDDENPASSWORD. PIN is 456.',
 'charged_no_product','2026-10-01T14:00Z','card',900,800,
 case when n=1 then 'completed' else 'needs_review' end,
 case when n=7 then null when n=8 then '2026-10-03T07:00Z'::timestamptz else '2026-10-02T07:00Z'::timestamptz end,
 case when n=7 then null else 'hosted_refund_intake' end from generate_series(1,8) n;
update public.refund_cases set duplicate_of_refund_case_id='e9760000-0000-4000-8000-000000000001'
 where id='e9760000-0000-4000-8000-000000000003';
update public.refund_cases set case_population='internal_test',internal_test_reason='employee_technician_test',
 internal_test_classified_at=now(),internal_test_classified_by='e9710000-0000-4000-8000-000000000001',
 status='closed',automation_state='closed_incomplete' where id='e9760000-0000-4000-8000-000000000006';
insert into private.refund_request_recognition_events(event_key,refund_case_id,event_kind,effective_at,recorded_at,
 tender,source,request_target_before_cents,request_target_after_cents,amount_basis,amount_provenance) values
 ('read:opening','e9760000-0000-4000-8000-000000000001','request_received','2026-10-02T07:00Z','2026-10-02T07:00Z',
 'card','hosted_refund_intake',0,600,'tax_inclusive','hosted_intake_customer_charge_estimate');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','e9710000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.get_refund_request_access()->>'hasAccess','true','Current technician has operational refund access');
select is(jsonb_array_length(public.get_refund_request_access()->'machines'),2,'Mixed role scope includes exactly technician and manager machines');
select is((select x->>'canOpenManagerWorkspace' from jsonb_array_elements(public.get_refund_request_access()->'machines') x where x->>'machineId'='e9740000-0000-4000-8000-000000000001'),'false','Technician machine does not gain management');
select is((select x->>'canOpenManagerWorkspace' from jsonb_array_elements(public.get_refund_request_access()->'machines') x where x->>'machineId'='e9740000-0000-4000-8000-000000000002'),'true','Manager rights remain scoped to the separately managed machine');
select is(public.has_reporting_machine_access('e9710000-0000-4000-8000-000000000002','e9740000-0000-4000-8000-000000000001'),false,'Technician fixture has no sales access');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001')->>'requestedAmountCents','600','Original requested dollars visible without sales, distinct from800 prepared and900 payment');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000002')->>'requestedAmountCents',null,'Unknown request does not fall back to prepared or payment amounts');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001')->>'statusLabel','Refund completed','Resolved requests remain available for troubleshooting');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000007')->>'receivedAt',null,'Undated direct detail remains accessible without inventing request time');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000005'),null::jsonb,'Same company does not confer another machine');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000006'),null::jsonb,'Internal tests never enter read API');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000003'),null::jsonb,'Duplicate child does not appear as another request');
select is(jsonb_array_length(public.get_refund_requests('2026-10-02','2026-10-02')->'requests'),3,'Period includes three visible root requests; no duplicate, internal, undated, unassigned or next-midnight record');
select is(public.get_refund_requests('2026-10-02','2026-10-02',null,1,0)#>>'{requests,0,caseId}','e9760000-0000-4000-8000-000000000004','Stable newest order breaks received-time ties by case ID');
select is(public.get_refund_requests('2026-10-02','2026-10-02',null,1,0)->>'hasMore','true','First limited page detects next page');
select is(public.get_refund_requests('2026-10-02','2026-10-02',null,1,1)#>>'{requests,0,caseId}','e9760000-0000-4000-8000-000000000002','Second page does not repeat first page');
select is(public.get_refund_requests('2026-10-02','2026-10-02',null,1,2)->>'hasMore','false','Final exact-size page is terminal');
select is(jsonb_array_length(public.get_refund_requests('2026-10-02','2026-10-02','e9740000-0000-4000-8000-000000000001')->'requests'),2,'Machine filter narrows scope');
select throws_ok($$select public.get_refund_requests('2026-10-02','2026-10-02','e9740000-0000-4000-8000-000000000003')$$,'42501',null,'Forged machine filter denied');
select throws_ok($$select public.get_refund_requests('2026-10-03','2026-10-02')$$,'22023',null,'Reversed dates rejected');
select throws_ok($$select public.get_refund_requests('2025-01-01','2026-10-02')$$,'22023',null,'Unbounded period rejected');
select throws_ok($$select public.get_refund_requests('2026-10-02','infinity')$$,'22023',null,'Infinite dates rejected');
select throws_ok($$select public.get_refund_requests('2026-10-02','2026-10-02',null,101,0)$$,'22023',null,'Page size bound enforced');
select throws_ok($$select public.get_refund_requests('2026-10-02','2026-10-02',null,50,-1)$$,'22023',null,'Negative offset rejected');
create temporary table safe_read as select public.get_refund_request('e9760000-0000-4000-8000-000000000001') p;
select ok((select p->>'comment' like '%motor pauses after 12 seconds%' and p->>'comment' like '%糖卡住了%' from safe_read),'Diagnostic timing and Unicode survive sanitization');
select ok((select p->>'comment' like '%Error code E05, spinner stopped%' from safe_read),'Machine error codes survive credential redaction');
select ok((select p->>'comment' like '%spin 12 seconds%' and p->>'comment' like '%pinion gear%' from safe_read),'PIN redaction does not consume a substring of spin or pinion');
select ok((select lower(p::text) not like '%jane%' and p::text not like '%person@example%' and p::text not like '%555-333%' and p::text not like '%1234%' and p::text not like '%SECRET123%' and p::text not like '%Private Street%' and p::text not like '%secret-pay%' from safe_read),'Known contacts redacted case-insensitively; addresses, card digits and tokens removed');
select ok((select p::text not like '%987%' and p::text not like '%HIDDENPASSWORD%' and p::text not like '%456%' from safe_read),'CVV, password-is and PIN-is credentials are removed');
select ok((select not(p ?| array['customerEmail','customerPhone','zellePaymentContact','paymentAmountCents','refundAmountCents','events','attachments','giftCardCode','providerPayload']) from safe_read),'Projection contains no dedicated private/payment/internal fields');
select is(public.can_manage_refund_machine('e9710000-0000-4000-8000-000000000002','e9740000-0000-4000-8000-000000000001'),false,'Read grant leaves existing manage-machine policy unchanged');
select is(public.can_manage_refund_case('e9710000-0000-4000-8000-000000000002','e9760000-0000-4000-8000-000000000001'),false,'Read grant leaves existing manage-case policy unchanged');
select is(public.refund_official_action_authority('e9710000-0000-4000-8000-000000000002','e9760000-0000-4000-8000-000000000001'),null::jsonb,'Read grant creates no approve/deny/payout authority');
set local role authenticated;
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001')->>'requestedAmountCents','600','Authenticated read RPC is callable');
select is((select count(*)::int from public.refund_cases where id='e9760000-0000-4000-8000-000000000001'),0,'Raw case RLS still hides technician case');
select throws_ok($$select public.admin_approve_reviewed_nayax_candidate_v1('e9760000-0000-4000-8000-000000000002',1,
 'e9790000-0000-4000-8000-000000000001','e9790000-0000-4000-8000-000000000002')$$,'42501',null,'Technician cannot approve card refund even when supplying proof IDs');
select throws_ok($$select public.admin_authorize_refund_official_action('e9760000-0000-4000-8000-000000000002','decline',1,
 'denied','denied')$$,'42501',null,'Technician cannot authorize refund denial');
select throws_ok($$select public.admin_authorize_refund_official_action('e9760000-0000-4000-8000-000000000002','cash_complete',1,
 'completed','approved',null,null,null,600,null,null,true)$$,'42501',null,'Technician cannot authorize cash payment confirmation');
select throws_ok($$select public.admin_decide_refund_gift_card('e9760000-0000-4000-8000-000000000001',true)$$,'42501',null,'Technician gift approval denied');
select throws_ok($$select public.admin_decide_refund_gift_card('e9760000-0000-4000-8000-000000000001',false)$$,'42501',null,'Technician gift denial denied');
select throws_ok($$select public.admin_get_refund_gmail_case_context('e9760000-0000-4000-8000-000000000001')$$,null,null,'Technician cannot obtain raw customer correspondence');
select throws_ok($$update public.refund_cases set refund_amount_cents=1 where id='e9760000-0000-4000-8000-000000000001'$$,'42501',null,'Technician cannot edit financial case fields directly');
reset role;
select ok(not has_function_privilege('anon','public.get_refund_request(uuid)','execute'),'Anonymous detail access denied');
select ok(not has_function_privilege('authenticated','private.refund_request_machine_scope(uuid)','execute'),'Client cannot impersonate another actor in private scope');
select ok(not has_function_privilege('authenticated','private.refund_request_read_projection(public.refund_cases,boolean)','execute'),'Client cannot bypass read scope with projection helper');
select ok(not has_function_privilege('authenticated','public.admin_update_refund_case(uuid,text,text,text,text,text,integer,text,boolean,text,integer,timestamp with time zone,integer,text,text)','execute'),'Raw financial editing RPC stays unavailable');
select set_config('request.jwt.claim.sub','e9710000-0000-4000-8000-000000000003',true);
select is(public.get_refund_request_access()->>'hasAccess','false','Sales-only user gains no refund read access');
select throws_ok($$select public.get_refund_requests('2026-10-02','2026-10-02')$$,'42501',null,'Sales-only request list denied');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001'),null::jsonb,'Sales-only direct detail denied');
select set_config('request.jwt.claim.sub','e9710000-0000-4000-8000-000000000001',true);
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001')->>'canOpenManagerWorkspace','true','Existing manager can read and open own workflow');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000004'),null::jsonb,'Manager does not gain unrelated machine in same company');
select set_config('request.jwt.claim.sub','e9710000-0000-4000-8000-000000000002',true);
-- Each scope query uses current assignment state, including deep links and mail.
update public.technician_machine_assignments set expires_at=now()-interval '1 day' where technician_grant_id='e9750000-0000-4000-8000-000000000001';
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001'),null::jsonb,'Expired assignment removes direct detail');
select throws_ok($$select private.email_alert_digest_metadata('e9710000-0000-4000-8000-000000000002','e9740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02')$$,'42501',null,'Expired assignment removes digest projection');
update public.technician_machine_assignments set expires_at=null,starts_at=now()+interval '1 day' where technician_grant_id='e9750000-0000-4000-8000-000000000001';
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001'),null::jsonb,'Future assignment grants no early access');
update public.technician_machine_assignments set starts_at='2020-01-01',status='revoked',revoked_at=now(),revoke_reason='Synthetic revocation' where technician_grant_id='e9750000-0000-4000-8000-000000000001';
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001'),null::jsonb,'Revoked assignment removes direct detail');
update public.technician_machine_assignments set status='active',revoked_at=null,revoke_reason=null where technician_grant_id='e9750000-0000-4000-8000-000000000001';
update public.technician_grants set expires_at=now()-interval '1 day' where id='e9750000-0000-4000-8000-000000000001';
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001'),null::jsonb,'Expired parent grant removes assignment access');
update public.technician_grants set expires_at=null,starts_at=now()+interval '1 day' where id='e9750000-0000-4000-8000-000000000001';
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001'),null::jsonb,'Future parent grant grants no early access');
update public.technician_grants set starts_at='2020-01-01',status='revoked',revoked_at=now(),revoke_reason='Synthetic revocation' where id='e9750000-0000-4000-8000-000000000001';
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001'),null::jsonb,'Revoked parent grant removes assignment access');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000004')->>'canOpenManagerWorkspace','true','Technician revocation does not remove independent manager grant');
update public.technician_grants set status='active',revoked_at=null,revoke_reason=null where id='e9750000-0000-4000-8000-000000000001';
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,machine_ids) values
 ('e9710000-0000-4000-8000-000000000002','new-refund',true,'selected',array['e9740000-0000-4000-8000-000000000001']::uuid[]);
create temporary table new_request_email as select private.email_alert_projection('e9710000-0000-4000-8000-000000000002','new-refund','2026-10-02T12:00Z','2026-10-02','2026-10-02','e9760000-0000-4000-8000-000000000001') p;
select is((select p#>>'{machines,0,refundCases,0,requestedAmountCents}' from new_request_email),'600','Immediate email uses original requested dollars');
select is((select p#>>'{machines,0,refundCases,0,canOpenCase}' from new_request_email),'true','Immediate email opens assigned technician read detail');
select is((select p#>>'{machines,0,refundCases,0,needsDecision}' from new_request_email),'false','Read link never requests a technician financial decision');
select is((select p#>>'{machines,0,refundCases,0,amountCents}' from new_request_email),null,'Prepared manager amount remains private');
select ok((select p#>>'{machines,0,refundCases,0,commentExcerpt}' like '%motor pauses after 12 seconds%' from new_request_email),'Immediate email preserves useful diagnostic comment');
select ok((select p::text not like '%Jane%' and p::text not like '%Private Street%' and p::text not like '%SECRET123%' from new_request_email),'Immediate email uses sanitized narrative');
select is(private.email_alert_digest_metadata('e9710000-0000-4000-8000-000000000002','e9740000-0000-4000-8000-000000000001','2026-10-02','2026-10-02')->>'requestedAmountCents','600','Technician digest amounts follow same original-request scope without sales');
-- Bound Unicode narrative at the client-facing boundary without inventing text.
set local session_replication_role=replica;
update public.refund_cases set issue_summary=repeat('糖',4001) where id='e9760000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(char_length(public.get_refund_request('e9760000-0000-4000-8000-000000000001')->>'comment'),4000,'Portal comments bounded by Unicode characters');
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001')->>'commentTruncated','true','Truncation is explicit');
-- A moved machine uses the same current machine-local day as its digest,
-- including requests whose historical incident location is elsewhere.
set local session_replication_role=replica;
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('e9730000-0000-4000-8000-000000000002','e9720000-0000-4000-8000-000000000001','New eastern location','Pacific/Kiritimati');
update public.reporting_machines set location_id='e9730000-0000-4000-8000-000000000002' where id='e9740000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(public.get_refund_request('e9760000-0000-4000-8000-000000000001')->>'timezone','Pacific/Kiritimati','Read detail follows canonical current machine timezone');
select is(jsonb_array_length(public.get_refund_requests('2026-10-03','2026-10-03','e9740000-0000-4000-8000-000000000001')->'requests'),
 (private.email_alert_digest_metadata('e9710000-0000-4000-8000-000000000002','e9740000-0000-4000-8000-000000000001','2026-10-03','2026-10-03')->>'newRequestCount')::int,
 'Moved-machine list and digest share identical period boundaries');
select * from finish();
rollback;
