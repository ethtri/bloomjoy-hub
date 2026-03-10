-- Extend support intake for structured WeChat onboarding concierge requests.

alter table public.support_requests
  add column if not exists intake_meta jsonb not null default '{}'::jsonb;

alter table public.support_requests
  drop constraint if exists support_requests_request_type_check;

alter table public.support_requests
  add constraint support_requests_request_type_check
  check (request_type in ('concierge', 'parts', 'wechat_onboarding'));

create index if not exists support_requests_request_type_created_at_idx
  on public.support_requests (request_type, created_at desc);
