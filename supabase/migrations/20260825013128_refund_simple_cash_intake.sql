-- Public refund intake now treats cash as a normal payment method. Managers
-- reimburse cash customers outside Bloomjoy Hub during the interim, so the
-- form and database must not require or collect payout-channel details.

alter table public.refund_cases
  drop constraint if exists refund_cases_cash_zelle_contact_present;

comment on column public.refund_cases.zelle_payment_contact is
  'Legacy historical payout contact. New hosted refund intake always stores NULL.';

-- Keep the existing customer-safe selection contract intact and add only the
-- detail needed by the one reviewed two-machine location. Ordinary locations
-- remain one choice; the ambiguous Livermore pair receives two plain labels so
-- a cash case can bind to one reporting machine without using Nayax.
create or replace function public.public_refund_selections_v2()
returns table (
  selection_key text,
  display_label text,
  selection_kind text,
  location_timezone text,
  machine_id uuid,
  cash_machine_options jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    selection.selection_key,
    selection.display_label,
    selection.selection_kind,
    selection.location_timezone,
    exact_option.machine_id,
    case
      when selection.selection_kind = 'livermore_pair' then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'machineId', pair_machine.machine_id,
            'displayLabel', case pair_machine.machine_id
              when '91bae5ac-4ba6-4378-91f0-ef266bdd4d7a'::uuid
                then 'TT20 cotton candy machine'
              when '8eda5a29-1718-4c70-9993-7c7e2fd6c65a'::uuid
                then 'TT33 cotton candy machine'
            end
          )
          order by pair_machine.machine_id = '8eda5a29-1718-4c70-9993-7c7e2fd6c65a'::uuid
        )
        from public.public_refund_machine_options() pair_machine
        where pair_machine.machine_id = any(public.refund_livermore_selection_machine_ids())
      ), '[]'::jsonb)
      else '[]'::jsonb
    end as cash_machine_options
  from public.public_refund_selections() selection
  left join public.public_refund_machine_options() exact_option
    on selection.selection_kind = 'exact_machine'
   and selection.selection_key = public.refund_public_selection_key(
     'machine|' || exact_option.machine_id::text
   );
$$;

comment on function public.public_refund_selections_v2() is
  'Customer-safe public refund selections with exact-machine context for cash intake at the one reviewed grouped location.';

revoke all on function public.public_refund_selections_v2() from public;
grant execute on function public.public_refund_selections_v2() to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
