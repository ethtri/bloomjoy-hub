-- #1729 rollout performance: digest metadata already starts from the current
-- authorized email machine scope. Do not rescan every refund-management machine
-- for each machine in every candidate digest. Reuse that row's live role flags;
-- the scope continues to enforce technician grant/assignment expiry/revocation.
-- Portal read RPCs and all manager/mutation authorization remain unchanged.
do $$declare d text;old_part text;new_part text;begin
 d:=pg_get_functiondef('private.email_alert_digest_metadata(uuid,uuid,date,date)'::regprocedure);
 old_part:='exists(select 1 from private.refund_request_machine_scope(p_user_id) r where r.machine_id=p_machine_id) as can_read_requests';
 new_part:='(s.is_manager or s.is_technician) as can_read_requests';
 if strpos(d,old_part)=0 then raise exception 'Digest read scope boundary changed';end if;
 execute replace(d,old_part,new_part);

 d:=pg_get_functiondef('private.email_alert_projection(uuid,text,timestamptz,date,date,uuid)'::regprocedure);
 old_part:=$old$machine_row.is_manager or (p_category='new-refund' and exists(select 1 from private.refund_request_machine_scope(p_user_id) r where r.machine_id=machine_row.machine_id))$old$;
 new_part:=$new$machine_row.is_manager or (p_category='new-refund' and machine_row.is_technician)$new$;
 if strpos(d,old_part)=0 then raise exception 'Email request read scope boundary changed';end if;
 execute replace(d,old_part,new_part);
end $$;
select pg_notify('pgrst','reload schema');
