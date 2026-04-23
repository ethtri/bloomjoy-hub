-- Autonomous marketing foundation: attribution, consent, and quote qualification.

alter table public.lead_submissions
  add column if not exists company_name text,
  add column if not exists machine_interest text,
  add column if not exists audience_segment text,
  add column if not exists purchase_timeline text,
  add column if not exists budget_status text,
  add column if not exists plus_interest boolean not null default false,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists attribution jsonb not null default '{}'::jsonb,
  add column if not exists qualification_grade text not null default 'C',
  add column if not exists qualification_signals jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_submissions_audience_segment_check'
      and conrelid = 'public.lead_submissions'::regclass
  ) then
    alter table public.lead_submissions
      add constraint lead_submissions_audience_segment_check
      check (
        audience_segment is null
        or audience_segment in (
          'commercial_operator',
          'event_operator',
          'venue_or_procurement',
          'consumer_home_buyer',
          'not_sure'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_submissions_purchase_timeline_check'
      and conrelid = 'public.lead_submissions'::regclass
  ) then
    alter table public.lead_submissions
      add constraint lead_submissions_purchase_timeline_check
      check (
        purchase_timeline is null
        or purchase_timeline in (
          'now_30_days',
          'one_to_three_months',
          'three_to_six_months',
          'six_plus_months',
          'not_sure'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_submissions_budget_status_check'
      and conrelid = 'public.lead_submissions'::regclass
  ) then
    alter table public.lead_submissions
      add constraint lead_submissions_budget_status_check
      check (
        budget_status is null
        or budget_status in (
          'budget_approved',
          'procurement_started',
          'evaluating_budget',
          'no_budget_yet',
          'not_sure'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_submissions_qualification_grade_check'
      and conrelid = 'public.lead_submissions'::regclass
  ) then
    alter table public.lead_submissions
      add constraint lead_submissions_qualification_grade_check
      check (qualification_grade in ('A', 'B', 'C'));
  end if;
end $$;

create index if not exists lead_submissions_qualification_created_at_idx
  on public.lead_submissions (qualification_grade, created_at desc);

create index if not exists lead_submissions_marketing_consent_created_at_idx
  on public.lead_submissions (marketing_consent, created_at desc);

create index if not exists lead_submissions_machine_interest_created_at_idx
  on public.lead_submissions (machine_interest, created_at desc)
  where machine_interest is not null;
