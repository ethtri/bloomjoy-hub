begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

select has_column(
  'public', 'lead_submissions', 'attribution',
  'Lead submissions have a dedicated attribution column'
);
select col_type_is(
  'public', 'lead_submissions', 'attribution', 'jsonb',
  'Lead attribution uses bounded structured JSON'
);
select col_not_null(
  'public', 'lead_submissions', 'attribution',
  'Lead attribution is never null'
);
select is(
  (
    select pg_get_expr(defaults.adbin, defaults.adrelid)
    from pg_attrdef defaults
    join pg_attribute attributes
      on attributes.attrelid = defaults.adrelid
     and attributes.attnum = defaults.adnum
    where defaults.adrelid = 'public.lead_submissions'::regclass
      and attributes.attname = 'attribution'
  ),
  '''{}''::jsonb',
  'Existing and unattributed leads default to an empty object'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.lead_submissions'::regclass),
  'Lead submissions retain row-level security'
);
select is(
  (
    select array_agg(policyname::text order by policyname)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_submissions'
  ),
  array[
    'lead_submissions_select_super_admin'
  ]::text[],
  'Attribution adds no browser read or mutation policies'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'lead_submissions_attribution_shape_check'
      and conrelid = 'public.lead_submissions'::regclass
      and contype = 'c'
      and convalidated
  ),
  'Lead attribution has a validated shape and size constraint'
);
select ok(
  pg_temp.capture_error($statement$
    insert into public.lead_submissions
      (submission_type, name, email, message, attribution)
    values
      ('general', 'Attribution Test', 'attribution-test@example.test', 'Test', '[]'::jsonb)
  $statement$) like '%lead_submissions_attribution_shape_check%',
  'Non-object attribution is rejected'
);
select ok(
  pg_temp.capture_error($statement$
    insert into public.lead_submissions
      (submission_type, name, email, message, attribution)
    values
      ('general', 'Attribution Test', 'attribution-test@example.test', 'Test', '{"version":2}'::jsonb)
  $statement$) like '%lead_submissions_attribution_shape_check%',
  'Unsupported attribution versions are rejected'
);
select ok(
  pg_temp.capture_error($statement$
    insert into public.lead_submissions
      (submission_type, name, email, message, attribution)
    values
      (
        'general',
        'Attribution Test',
        'attribution-test@example.test',
        'Test',
        jsonb_build_object('version', 1, 'padding', repeat('x', 5000))
      )
  $statement$) like '%lead_submissions_attribution_shape_check%',
  'Oversized attribution is rejected'
);

select * from finish();
rollback;
