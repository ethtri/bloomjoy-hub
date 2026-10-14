-- Snapshot reconciliation and statement creation share now() in one transaction.
-- Only changes strictly after that generation boundary make its snapshot stale.
-- Preserve the independent time-source revision guard, scope and existing ACLs.
do $freshness_boundary$
declare
  definition text := pg_get_functiondef(
    'private.operator_pay_stub_regeneration_required(uuid,date,date)'::regprocedure);
  snapshot_anchor text := 'snapshot.regenerated_at >= latest.generated_at';
  audit_anchor text := 'audit.created_at >= latest.generated_at';
begin
  if (length(definition) - length(replace(definition, snapshot_anchor, '')))
      / length(snapshot_anchor) <> 1
    or (length(definition) - length(replace(definition, audit_anchor, '')))
      / length(audit_anchor) <> 1 then
    raise exception 'Pay Stub snapshot freshness comparison changed';
  end if;
  execute replace(replace(definition,
    snapshot_anchor, 'snapshot.regenerated_at > latest.generated_at'),
    audit_anchor, 'audit.created_at > latest.generated_at');
end;
$freshness_boundary$;
