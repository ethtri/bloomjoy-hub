-- Preserve the caller-rights completion guard while avoiding a private helper
-- call that unprivileged message writers cannot execute. Supported completion
-- functions run as their owner and retain the exact claimed-to-queued path.
create or replace function public.guard_refund_receipt_completion_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
    and old.status = 'pending' and new.status = 'pending'
    and old.manual_delivery_state = 'claimed' and new.manual_delivery_state = 'queued'
    and old.manual_delivery_claim_token is not null and new.manual_delivery_claim_token is null
    and old.manual_delivery_claimed_at is not null and new.manual_delivery_claimed_at is null
    and new.manual_delivery_provider_attempted_at is null
    and (to_jsonb(new) - array[
      'manual_delivery_state', 'manual_delivery_claim_token',
      'manual_delivery_claimed_at', 'manual_delivery_provider_attempted_at'
    ]::text[]) is not distinct from (to_jsonb(old) - array[
      'manual_delivery_state', 'manual_delivery_claim_token',
      'manual_delivery_claimed_at', 'manual_delivery_provider_attempted_at'
    ]::text[]) then
    if current_user not in ('anon', 'authenticated', 'service_role') then
      if public.is_refund_receipt_automatic_completion_message(old.id) then
        return new;
      end if;
    end if;
  end if;

  if (tg_op = 'INSERT' or old.template_version is distinct from 'refund_receipt_completion_v1')
    and (tg_op = 'DELETE' or new.template_version is distinct from 'refund_receipt_completion_v1') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'Receipt completion is owned by the supported delivery functions'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not public.is_refund_receipt_completion_message(to_jsonb(new))
      or new.manual_delivery_state is distinct from 'queued'
      or new.status is distinct from 'pending'
      or new.manual_delivery_provider_attempted_at is not null
      or new.manual_delivery_attempt_count <> 0 then
      raise exception 'Valid receipt completion authority is required'
        using errcode = 'P4664';
    end if;
    return new;
  end if;

  if exists(
    select 1
    from public.refund_receipt_completion_intents i
    where i.message_id = old.id
  ) then
    if tg_op = 'DELETE'
      or public.refund_receipt_completion_message_digest(to_jsonb(old))
        is distinct from public.refund_receipt_completion_message_digest(to_jsonb(new)) then
      raise exception 'Receipt completion identity is immutable'
        using errcode = 'P4664';
    end if;
    if (old.manual_delivery_provider_attempted_at is not null
        and new.manual_delivery_provider_attempted_at
          is distinct from old.manual_delivery_provider_attempted_at)
      or new.manual_delivery_attempt_count < old.manual_delivery_attempt_count
      or new.manual_delivery_attempt_count > old.manual_delivery_attempt_count + 1
      or (new.manual_delivery_attempt_count > old.manual_delivery_attempt_count
        and not (
          old.manual_delivery_state = 'queued'
          and new.manual_delivery_state = 'claimed'
        ))
      or not (
        new.manual_delivery_state = old.manual_delivery_state
        or (
          old.manual_delivery_state = 'queued'
          and new.manual_delivery_state in ('claimed', 'failed')
        )
        or (
          old.manual_delivery_state = 'claimed'
          and new.manual_delivery_state in ('sent', 'failed', 'delivery_unknown')
        )
        or (
          old.manual_delivery_state = 'claimed'
          and new.manual_delivery_state = 'queued'
          and old.manual_delivery_provider_attempted_at is null
        )
      ) then
      raise exception 'Receipt completion delivery cannot be replayed or its attempt erased'
        using errcode = 'P4664';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_refund_receipt_completion_identity()
  from public, anon, authenticated, service_role;
