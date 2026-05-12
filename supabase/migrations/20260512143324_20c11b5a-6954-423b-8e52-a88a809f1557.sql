
create table if not exists public.billing_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  terms_version text not null default '2026-05-11',
  refund_version text not null default '2026-05-11',
  privacy_version text not null default '2026-05-11',
  acknowledged_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  context text not null default 'upgrade_checkout'
);

alter table public.billing_acknowledgments enable row level security;

create policy "ba_read" on public.billing_acknowledgments
  for select to authenticated
  using (can_read_org(organization_id));

create policy "ba_insert_self" on public.billing_acknowledgments
  for insert to authenticated
  with check (user_id = auth.uid() and can_admin_org(organization_id));

create index if not exists billing_acks_org_idx on public.billing_acknowledgments(organization_id, acknowledged_at desc);
