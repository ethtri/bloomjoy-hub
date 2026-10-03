begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email)
 select ('ee710000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'preview-'||i||'@example.invalid' from generate_series(1,34) i;
insert into public.customer_accounts(id,name,account_type)
 values('ee720000-0000-4000-8000-000000000001','Preview fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ee730000-0000-4000-8000-000000000001','ee720000-0000-4000-8000-000000000001','Preview fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('ee740000-0000-4000-8000-000000000001','ee720000-0000-4000-8000-000000000001','ee730000-0000-4000-8000-000000000001','Preview fixture','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select 'ee740000-0000-4000-8000-000000000001',u.id,u.email,'active' from auth.users u where u.email like 'preview-%@example.invalid';
set local session_replication_role=origin;
create temporary table preview_pages(n integer primary key,p jsonb);
do $$declare page jsonb;cursor_value jsonb;page_number integer:=0;
begin
 loop
  page_number:=page_number+1;
  if page_number>40 then raise exception 'Preview cursor failed to terminate';end if;
  page:=public.service_preview_email_alerts('2026-10-03T15:00Z',1,cursor_value);
  insert into preview_pages values(page_number,page);
  exit when page->>'hasMore'='false';
  cursor_value:=page->'nextCursor';
 end loop;
end $$;
select is((select count(*)::integer from preview_pages),34,'Every recipient is reachable beyond the old thirty-recipient cap');
select is((select count(distinct x->>'userId')::integer from preview_pages cross join lateral jsonb_array_elements(p->'projections') x),34,'Keyset traversal repeats and skips no recipients');
select ok((select bool_and((p->>'pageCount')::integer=1 and jsonb_array_length(p->'projections')=1) from preview_pages),'Every page contains one complete recipient');
select ok((select bool_and((p->>'totalCandidates')::integer=34) from preview_pages),'Each page reports total candidate coverage');
select ok((select bool_and(p->>'hasMore'='true' and p->>'complete'='false' and p->'nextCursor'<>'null'::jsonb) from preview_pages where n<34),'Partial pages explicitly require continuation');
select ok((select p->>'hasMore'='false' and p->>'complete'='true' and p->'nextCursor'='null'::jsonb from preview_pages where n=34),'Final page explicitly ends traversal');
select is(public.service_preview_email_alerts('2026-10-03T15:00Z',1,(select p->'nextCursor' from preview_pages where n=1)),
 (select p from preview_pages where n=2),'Retrying a preview cursor returns the same bounded read-only page');
select throws_ok($$select public.service_preview_email_alerts('2026-10-03T15:05Z',1,(select p->'nextCursor' from preview_pages where n=1))$$,
 '22023','Invalid preview continuation or observation time','A continuation cannot silently drift to another schedule snapshot');
select throws_ok($$select public.service_preview_email_alerts('2026-10-03T15:00Z',2)$$,
 '22023','Preview requires an observation time and a one-recipient page','Callers cannot recreate an unbounded projection batch');
select throws_ok($$select public.service_preview_email_alerts('2026-10-03T15:00Z',1,
 '{"observedAt":"2026-10-03T15:00Z","userId":"ee710000-0000-4000-8000-000000000001","category":null,"slotKey":"daily:2026-10-02"}')$$,
 '22023','Invalid preview continuation or observation time','Nullable cursor fields fail closed');
select ok(not has_function_privilege('authenticated','public.service_preview_email_alerts(timestamptz,integer,jsonb)','execute'),'Paginated preview is never exposed to user JWTs');
select is((select count(*)::integer from private.email_alert_jobs),0,'All preview pages create no delivery jobs');
select is((select count(*)::integer from public.refund_manager_digest_batches),0,'All preview pages reserve no legacy daily slots');
select * from finish();
rollback;
