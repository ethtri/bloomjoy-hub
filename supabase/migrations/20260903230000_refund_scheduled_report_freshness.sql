-- #973: delivery freshness is an operations review signal, never payment evidence.
alter function public.get_refund_gmail_health()
  rename to get_refund_gmail_health_pre_report_freshness;
revoke all on function public.get_refund_gmail_health_pre_report_freshness()
  from public, anon, authenticated, service_role;

create function public.get_refund_gmail_health()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; latest_received timestamptz; review_after timestamptz;
begin
  -- Preserve the existing authenticated manager/scoped-admin access boundary.
  result := public.get_refund_gmail_health_pre_report_freshness();
  -- Account-wide vendor delivery evidence belongs only to Refund Operations.
  if not public.is_super_admin(auth.uid()) then
    return result || jsonb_build_object('reportFreshness',null);
  end if;
  select max(received_at) into latest_received
    from public.nayax_scheduled_report_messages;
  review_after := latest_received + interval '120 minutes';
  return result || jsonb_build_object('reportFreshness',jsonb_build_object(
    'status',case when latest_received is null then 'unobserved'
      when now() >= review_after then 'needs_review' else 'recent' end,
    'lastReceivedAt',latest_received,
    'reviewAfter',review_after,
    'configuredCadenceMinutes',60,
    'reviewGraceMinutes',120,
    'schedulePhaseKnown',false,
    'ownerLabel','Refund Operations'
  ));
end;
$$;
revoke all on function public.get_refund_gmail_health() from public,anon;
grant execute on function public.get_refund_gmail_health() to authenticated;
comment on function public.get_refund_gmail_health() is
  'Existing Gmail health plus operations-only native report freshness. Verified hourly setting; 120 minutes is local review grace, not a provider SLA or predicted next run. Read-only, no alert send or payment gate.';
