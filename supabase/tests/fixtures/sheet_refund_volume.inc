-- Synthetic cutoff is fixed before calculations; only this rollback fixture disables the immutable setup trigger.
set local session_replication_role=replica;
insert into private.refund_request_recognition_rollout(singleton,activated_at,activated_by)
 values(true,'2026-10-01','Synthetic Sheet evidence fixture') on conflict(singleton) do update set activated_at=excluded.activated_at;
set local session_replication_role=replica;
insert into auth.users(id,email) values('b1824000-0000-4000-8000-000000000091','sheet-evidence@example.invalid');
insert into customer_accounts(id,name) values('b1824100-0000-4000-8000-000000000091','Sheet evidence fixture');
insert into reporting_locations(id,account_id,name,timezone) values
 ('b1824200-0000-4000-8000-000000000091','b1824100-0000-4000-8000-000000000091','Sheet site','America/Los_Angeles');
insert into reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key) values
 ('b1824300-0000-4000-8000-000000000091','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Consistent','1824000091','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000092','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Conflicting','1824000092','TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000093','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','No evidence',null,'TGPACI_USA_DB'),
 ('b1824300-0000-4000-8000-000000000094','b1824100-0000-4000-8000-000000000091','b1824200-0000-4000-8000-000000000091','Historical only',null,'TGPACI_USA_DB');
insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason) values
 ('TGPACI_USA_DB','1824000094','b1824300-0000-4000-8000-000000000091','same_physical_machine_all_history','b1824000-0000-4000-8000-000000000091','Synthetic consistent old reader'),
 ('TGPACI_USA_DB','1824000095','b1824300-0000-4000-8000-000000000092','same_physical_machine_all_history','b1824000-0000-4000-8000-000000000091','Synthetic conflicting old reader'),
 ('TGPACI_USA_DB','1824000096','b1824300-0000-4000-8000-000000000094','same_physical_machine_all_history','b1824000-0000-4000-8000-000000000091','Synthetic historical only reader');
insert into private.nayax_machine_tax_observations(account_key,nayax_machine_id,observed_at,source,classification,rate_percent,provenance,effective_start_date,effective_end_date)
select 'TGPACI_USA_DB',reader,'2026-10-08','owner_stable_rate','verified_tax',rate,
 '#1824; owner attestation: synthetic unchanged machine rates; verified observation IDs=synthetic','-infinity','2026-10-08'
from (values('1824000091',8::numeric),('1824000094',8::numeric),('1824000092',0.09::numeric),('1824000095',9::numeric),('1824000096',8::numeric)) fixtures(reader,rate);
insert into refund_adjustment_review_rows(id,source_reference,source_row_reference,source_row_hash,source_location,
 refund_date,original_order_date,amount_cents,match_status,match_confidence,matched_machine_id)
 values('b1824600-0000-4000-8000-000000000091','sheet:synthetic','synthetic-request',repeat('a',64),'Sheet site',
 '2026-09-30','2026-09-15',1080,'applied',1,'b1824300-0000-4000-8000-000000000091');
set local session_replication_role=origin;
insert into sales_adjustment_facts(id,reporting_machine_id,reporting_location_id,adjustment_date,adjustment_type,
 amount_cents,source,source_reference,source_row_reference,source_row_hash,raw_payload,created_at,updated_at,refund_review_row_id,match_status,match_confidence)
values('b1824500-0000-4000-8000-000000000091','b1824300-0000-4000-8000-000000000091',
 'b1824200-0000-4000-8000-000000000091','2026-09-30','refund',1080,'google_sheets','sheet:synthetic','synthetic-request',repeat('a',64),
 '{"amount_source":"refund_amount","source_status":"Closed","source_decision":"Approve","original_order_date":"2026-09-15","source_location":"Sheet site","refund_date":"2026-09-30"}',
 '2026-09-30','2026-09-30','b1824600-0000-4000-8000-000000000091','applied',1);
set local session_replication_role=origin;
