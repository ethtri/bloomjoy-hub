-- Persisted support requests + admin triage workflow (issue #45)

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('concierge', 'parts')),
  status text not null default 'new' check (status in ('new', 'triaged', 'waiting_on_customer', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  customer_user_id uuid not null references auth.users (id) on delete cascade,
  customer_email text not null,
  subject text not null,
  message text not null,
  assigned_to uuid references auth.users (id) on delete set null,
  internal_notes text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_requests_customer_user_id_idx
  on public.support_requests (customer_user_id);

create index if not exists support_requests_status_created_at_idx
  on public.support_requests (status, created_at desc);

create index if not exists support_requests_assigned_to_idx
  on public.support_requests (assigned_to);

create index if not exists support_requests_customer_email_idx
  on public.support_requests (customer_email);

drop trigger if exists support_requests_set_updated_at on public.support_requests;

create trigger support_requests_set_updated_at
before update on public.support_requests
for each row execute function public.set_updated_at();

alter table public.support_requests enable row level security;

drop policy if exists "support_requests_select_own_or_super_admin" on public.support_requests;
drop policy if exists "support_requests_insert_own" on public.support_requests;
drop policy if exists "support_requests_update_super_admin" on public.support_requests;

create policy "support_requests_select_own_or_super_admin"
on public.support_requests
for select
using (
  auth.uid() = customer_user_id
  or public.is_super_admin(auth.uid())
);

create policy "support_requests_insert_own"
on public.support_requests
for insert
with check (
  auth.uid() = customer_user_id
);

create policy "support_requests_update_super_admin"
on public.support_requests
for update
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop function if exists public.admin_update_support_request(uuid, text, text, uuid, text);

create or replace function public.admin_update_support_request(
  p_request_id uuid,
  p_status text,
  p_priority text,
  p_assigned_to uuid,
  p_internal_notes text
)
returns public.support_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.support_requests;
  after_row public.support_requests;
  normalized_status text;
  normalized_priority text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  normalized_status := coalesce(trim(lower(p_status)), '');
  normalized_priority := coalesce(trim(lower(p_priority)), '');

  if normalized_status not in ('new', 'triaged', 'waiting_on_customer', 'resolved', 'closed') then
    raise exception 'Invalid support status: %', p_status;
  end if;

  if normalized_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid support priority: %', p_priority;
  end if;

  select *
  into before_row
  from public.support_requests
  where id = p_request_id;

  if before_row.id is null then
    raise exception 'Support request not found';
  end if;

  update public.support_requests
  set
    status = normalized_status,
    priority = normalized_priority,
    assigned_to = p_assigned_to,
    internal_notes = p_internal_notes,
    resolved_at = case when normalized_status = 'resolved' then coalesce(resolved_at, now()) else null end,
    resolved_by = case when normalized_status = 'resolved' then coalesce(resolved_by, auth.uid()) else null end
  where id = p_request_id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after
  )
  values (
    auth.uid(),
    'support_request.updated',
    'support_request',
    after_row.id::text,
    after_row.customer_user_id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_update_support_request(uuid, text, text, uuid, text) to authenticated;
