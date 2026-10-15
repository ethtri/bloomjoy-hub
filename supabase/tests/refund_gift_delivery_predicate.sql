begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(private.refund_gift_delivery_unresolved('{"manual_delivery_state":"delivery_unknown"}'),
 'A missing provider receipt never resolves unknown');
select ok(private.refund_gift_delivery_unresolved('{"manual_delivery_state":"delivery_unknown","delivery_state":"accepted"}'),
 'An unbound accepted label never resolves unknown');
select ok(private.refund_gift_delivery_unresolved('{"manual_delivery_state":"delivery_unknown","delivery_transport":"resend","provider_message_id":"synthetic-provider","delivery_state":"delivered"}'),
 'A provider reference without observed timestamp never resolves unknown');
select ok(private.refund_gift_delivery_unresolved('{"manual_delivery_state":"delivery_unknown","delivery_transport":"gmail_thread","provider_message_id":"synthetic-provider","delivery_state_updated_at":"2026-10-15T00:00:00Z","delivery_state":"delivered"}'),
 'Wrong transport cannot prove a gift send');
select ok(private.refund_gift_delivery_unresolved('{"manual_delivery_state":"claimed","manual_delivery_provider_attempted_at":"2026-10-15T00:00:00Z","delivery_transport":"resend","provider_message_id":"synthetic-provider","delivery_state_updated_at":"2026-10-15T00:00:00Z","delivery_state":"accepted"}'),
 'A provider-started live claim stays held until settled');
select ok(private.refund_gift_delivery_unresolved('{"manual_delivery_state":"delivery_unknown","delivery_transport":"resend","provider_message_id":"x","delivery_state_updated_at":"2026-10-15T00:00:00Z","delivery_state":"delivered"}'),
 'An invalid provider identity cannot prove delivery');
select ok(not private.refund_gift_delivery_unresolved(jsonb_build_object(
 'manual_delivery_state','delivery_unknown','delivery_transport','resend','provider_message_id','synthetic-provider',
 'delivery_state_updated_at','2026-10-15T00:00:00Z','delivery_state',state)),
 'Exact settled ledger outcome resolves stale unknown: '||state)
 from unnest(array['accepted','deferred','delivered','failed','bounced','complained']) state;
select ok(not private.refund_gift_delivery_unresolved('{"manual_delivery_state":"failed","delivery_state":"unknown"}'),
 'A definite pre-provider failure can recover without another issuance');
select ok(not has_function_privilege('authenticated','private.refund_gift_delivery_recovery(uuid)','EXECUTE'),
 'Manager clients cannot bypass scoped case reads with private recovery helper');
select ok(not has_function_privilege('anon','private.refund_gift_delivery_unresolved(jsonb)','EXECUTE'),
 'Delivery proof helper does not add public capabilities');
select * from finish();
rollback;
