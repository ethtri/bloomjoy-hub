-- A historical no-safe-match send can retain unknown transport evidence even
-- when it never asked the customer for a field and the current case still has
-- no customer-correctable field. Preserve that immutable message evidence, but
-- do not report it as a current clarification obligation. It is internal
-- purchase research, not customer-wait work.
do $obsolete_clarification_health$
declare
  body text;
  eligible_anchor text;
  eligible_replacement text;
  classification_anchor text;
  classification_replacement text;
  output_anchor text;
  output_replacement text;
begin
  body := replace(pg_get_functiondef(
    'public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamptz)'::regprocedure),
    E'\r\n', E'\n');

  eligible_anchor := $anchor$    select c.id,c.deterministic_fact_version,o.truth,$anchor$;
  eligible_replacement := $replacement$    select c.id,c.deterministic_fact_version,o.truth,
      request.message_type request_message_type,
      request.requested_fields request_requested_fields,
      public.refund_purchase_correction_request_fields(c.id) current_requested_fields,$replacement$;

  classification_anchor := $anchor$    select *,case
      when delivery_state in ('failed','bounced','complained')$anchor$;
  classification_replacement := $replacement$    select *,case
      when truth->>'state'='delivery_unknown'
        and request_id is not null
        and request_message_type in ('more_info','no_safe_match')
        and jsonb_typeof(truth->'requestedFields')='array'
        and truth->'requestedFields'='[]'::jsonb
        and request_requested_fields='{}'::text[]
        and current_requested_fields='{}'::text[]
        then 'resolved_obsolete'
      when delivery_state in ('failed','bounced','complained')$replacement$;

  output_anchor := $anchor$    'unresolvedCount',count(*),$anchor$;
  output_replacement := $replacement$    'unresolvedCount',count(*),
    'resolvedObsoleteCount',(select count(*) from classified
      where obligation_state='resolved_obsolete'),$replacement$;

  if cardinality(string_to_array(body,eligible_anchor))<>2
    or cardinality(string_to_array(body,classification_anchor))<>2
    or cardinality(string_to_array(body,output_anchor))<>2 then
    raise exception 'Unexpected clarification obligation health shape'
      using errcode='P4652';
  end if;

  execute replace(replace(replace(body,
    eligible_anchor,eligible_replacement),
    classification_anchor,classification_replacement),
    output_anchor,output_replacement);
end;
$obsolete_clarification_health$;

comment on function public.service_get_refund_clarification_contact_obligation_health(
  boolean,boolean,timestamptz) is
  'Redacted current clarification-delivery health. Historical unknown transport remains auditable; an exact empty question with no current customer-correctable field is resolved obsolete rather than reported as current customer work.';
