-- Add operational contact details to the already actor-scoped People &
-- Permissions directory. The privileged helper lives in the private schema and
-- enriches only the page returned by the existing scoped directory function.

create or replace function private.admin_list_access_people_with_contacts(
  p_search text default null,
  p_role text default null,
  p_account_id uuid default null,
  p_status text default null,
  p_machine_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  directory jsonb;
begin
  if actor_user_id is null or not public.is_admin(actor_user_id) then
    raise exception 'Admin access required';
  end if;

  directory := private.admin_list_access_people(
    p_search,
    p_role,
    p_account_id,
    p_status,
    p_machine_id,
    p_limit,
    p_offset
  );

  return jsonb_set(
    directory,
    '{items}',
    coalesce((
      select jsonb_agg(
        person.item || jsonb_build_object(
          'contactEmail', coalesce(
            nullif(trim(contact.contact_email), ''),
            nullif(trim(person.item ->> 'email'), '')
          ),
          'contactPhone', coalesce(
            nullif(trim(contact.contact_phone), ''),
            nullif(trim(profile.phone), '')
          ),
          'mailingAddress', coalesce(
            nullif(trim(contact.mailing_address), ''),
            nullif(trim(both E'\n' from concat_ws(
              E'\n',
              nullif(trim(profile.shipping_street_1), ''),
              nullif(trim(profile.shipping_street_2), ''),
              nullif(trim(concat_ws(
                ', ',
                nullif(trim(profile.shipping_city), ''),
                nullif(trim(concat_ws(
                  ' ',
                  nullif(trim(profile.shipping_state), ''),
                  nullif(trim(profile.shipping_postal_code), '')
                )), '')
              )), ''),
              nullif(trim(profile.shipping_country), '')
            )), '')
          )
        )
        order by person.item_ordinality
      )
      from jsonb_array_elements(coalesce(directory -> 'items', '[]'::jsonb))
        with ordinality as person(item, item_ordinality)
      left join public.operator_contact_details contact
        on contact.user_id = nullif(person.item ->> 'userId', '')::uuid
      left join public.customer_profiles profile
        on profile.user_id = nullif(person.item ->> 'userId', '')::uuid
    ), '[]'::jsonb),
    true
  );
end;
$$;

comment on function private.admin_list_access_people_with_contacts(
  text, text, uuid, text, uuid, integer, integer
) is
  'Enriches only the actor-scoped People & Permissions page with protected contact details. Operator contact values take precedence over customer profile values.';

revoke all on function private.admin_list_access_people_with_contacts(
  text, text, uuid, text, uuid, integer, integer
) from public, anon;
grant execute on function private.admin_list_access_people_with_contacts(
  text, text, uuid, text, uuid, integer, integer
) to authenticated, service_role;

create or replace function public.admin_list_access_people(
  p_search text default null,
  p_role text default null,
  p_account_id uuid default null,
  p_status text default null,
  p_machine_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_list_access_people_with_contacts(
    p_search,
    p_role,
    p_account_id,
    p_status,
    p_machine_id,
    p_limit,
    p_offset
  );
$$;

comment on function public.admin_list_access_people(
  text, text, uuid, text, uuid, integer, integer
) is
  'Returns the paginated, actor-scoped People & Permissions roster with available email, phone, and mailing address details.';

revoke all on function public.admin_list_access_people(
  text, text, uuid, text, uuid, integer, integer
) from public, anon;
grant execute on function public.admin_list_access_people(
  text, text, uuid, text, uuid, integer, integer
) to authenticated, service_role;
