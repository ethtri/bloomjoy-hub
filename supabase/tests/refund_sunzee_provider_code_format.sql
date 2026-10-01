-- Synthetic inventory only; the ordinary private importer is the test subject.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
do $$
declare sunzee_pool_id uuid:='71000000-0000-4000-8000-000000000001';
  kemore_id uuid:='71000000-0000-4000-8000-000000000002';
  batch jsonb; result jsonb; invalid jsonb; rejected boolean;
begin
  insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
    eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
  values(sunzee_pool_id,'sunzee','synthetic-code-owner',1500,array['71000000-0000-4000-8000-000000000003'::uuid],
    array['Synthetic location'],now()+interval '60 days',false,'Synthetic instructions'),
    (kemore_id,'kemore','synthetic-code-owner',1500,array['71000000-0000-4000-8000-000000000003'::uuid],
    array['Synthetic location'],now()+interval '60 days',false,'Synthetic instructions');
  select jsonb_agg(jsonb_build_object('provider_code_id','fixture-'||code,'code',code,
    'valid_from',now()-interval '1 minute','expires_at',now()+interval '90 days')) into batch
  from unnest(array['1','12345','999999','012345']) code;
  result:=public.internal_import_refund_gift_card_codes(sunzee_pool_id,batch,'synthetic_format');
  if (result->>'importedCount')::integer<>4 or not exists(
    select 1 from public.refund_gift_card_codes where pool_id=sunzee_pool_id and code='12345') then
    raise exception 'Exact shorter Sunzee codes must import without padding';
  end if;
  update public.refund_gift_card_codes set status='issued' where code='12345' and provider_account_id='synthetic-code-owner';
  result:=public.internal_import_refund_gift_card_codes(sunzee_pool_id,batch,'synthetic_replay');
  if (result->>'replayedCount')::integer<>4 or not exists(select 1 from public.refund_gift_card_codes
    where code='12345' and provider_account_id='synthetic-code-owner' and status='issued') then
    raise exception 'Replay must preserve the same issued code';
  end if;
  for invalid in select value from jsonb_array_elements('["0","000000","-1","1.5","1000000","abc",12345]'::jsonb) loop
    rejected:=false;
    begin
      perform public.internal_import_refund_gift_card_codes(sunzee_pool_id,jsonb_build_array(
        (batch->0)||jsonb_build_object('provider_code_id','invalid-'||invalid::text,'code',invalid)),'synthetic_invalid');
    exception when raise_exception then rejected:=true;
    end;
    if not rejected then raise exception 'Invalid Sunzee format accepted'; end if;
  end loop;
  result:=public.internal_import_refund_gift_card_codes(kemore_id,jsonb_build_array(
    (batch->0)||jsonb_build_object('provider_code_id','kemore-leading-zero','code','000000123')),'synthetic_kemore');
  if (result->>'importedCount')::integer<>1 then raise exception 'KeMore exact nine digits must remain valid'; end if;
  rejected:=false;
  begin
    perform public.internal_import_refund_gift_card_codes(kemore_id,jsonb_build_array(
      (batch->0)||jsonb_build_object('provider_code_id','kemore-short','code','12345')),'synthetic_kemore_invalid');
  exception when raise_exception then rejected:=true;
  end;
  if not rejected then raise exception 'KeMore short code accepted'; end if;
end $$;
select pass('Sunzee exact numeric code formats, immutable replay and KeMore nine-digit identity');
select * from finish();
rollback;
