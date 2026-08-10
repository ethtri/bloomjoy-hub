-- Privacy-safe, versioned first-touch/last-touch context for public lead intake (#616).

alter table public.lead_submissions
  add column if not exists attribution jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_submissions_attribution_shape_check'
      and conrelid = 'public.lead_submissions'::regclass
  ) then
    alter table public.lead_submissions
      add constraint lead_submissions_attribution_shape_check
      check (
        jsonb_typeof(attribution) = 'object'
        and pg_column_size(attribution) <= 4096
        and (
          not (attribution ? 'version')
          or attribution ->> 'version' = '1'
        )
      );
  end if;
end $$;

comment on column public.lead_submissions.attribution is
  'Allowlisted session-scoped first-touch, last-touch, and conversion context. No form values, full referrer URLs, click IDs, or exact planner financial assumptions.';

select pg_notify('pgrst', 'reload schema');
