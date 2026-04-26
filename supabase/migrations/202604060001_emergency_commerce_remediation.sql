-- Emergency commerce remediation: richer order snapshots, notification status, and pricing metadata.

alter table public.orders
  add column if not exists order_type text not null default 'unknown'
    check (order_type in ('sugar', 'blank_sticks', 'unknown')),
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists billing_address jsonb,
  add column if not exists shipping_name text,
  add column if not exists shipping_phone text,
  add column if not exists shipping_address jsonb,
  add column if not exists pricing_tier text
    check (pricing_tier in ('plus_member', 'standard')),
  add column if not exists unit_price_cents integer,
  add column if not exists shipping_total_cents integer,
  add column if not exists internal_notification_error text,
  add column if not exists wecom_alert_sent_at timestamptz,
  add column if not exists wecom_alert_error text,
  add column if not exists customer_confirmation_sent_at timestamptz,
  add column if not exists customer_confirmation_error text;

create index if not exists orders_order_type_created_at_idx
  on public.orders (order_type, created_at desc);

create index if not exists orders_pricing_tier_created_at_idx
  on public.orders (pricing_tier, created_at desc);
