alter table public.customer_profiles
add column if not exists language_preference text not null default 'en';

alter table public.customer_profiles
drop constraint if exists customer_profiles_language_preference_check;

alter table public.customer_profiles
add constraint customer_profiles_language_preference_check
check (language_preference in ('en', 'zh-Hans'));
