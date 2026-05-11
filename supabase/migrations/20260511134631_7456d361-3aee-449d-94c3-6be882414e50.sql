-- =====================================================================
-- 1. Subscription status enum
-- =====================================================================
do $$ begin
  create type public.org_sub_status as enum ('grandfathered','trial','active','past_due','suspended');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 2. org_subscriptions table (one row per organization)
-- =====================================================================
create table if not exists public.org_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  status public.org_sub_status not null default 'trial',
  -- Trial limits
  trial_nvr_limit int not null default 1,
  trial_email_limit int not null default 5,
  trial_emails_sent int not null default 0,
  -- Paddle linkage
  paddle_subscription_id text unique,
  paddle_customer_id text,
  product_id text,
  price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  environment text not null default 'sandbox',
  -- Audit
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_subs_status on public.org_subscriptions(status);
create index if not exists idx_org_subs_paddle on public.org_subscriptions(paddle_subscription_id);

-- Auto-update updated_at
drop trigger if exists trg_org_subs_updated_at on public.org_subscriptions;
create trigger trg_org_subs_updated_at
  before update on public.org_subscriptions
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 3. Grandfather all existing organizations
-- =====================================================================
insert into public.org_subscriptions (organization_id, status, notes)
select id, 'grandfathered', 'Existing org at launch — no payment required'
from public.organizations
on conflict (organization_id) do nothing;

-- =====================================================================
-- 4. redemption_codes table
-- =====================================================================
create table if not exists public.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  duration_days int not null default 30,
  max_uses int not null default 1,
  uses int not null default 0,
  expires_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.redemption_code_uses (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.redemption_codes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  redeemed_by uuid,
  redeemed_at timestamptz not null default now()
);

create index if not exists idx_code_uses_org on public.redemption_code_uses(organization_id);

-- =====================================================================
-- 5. RLS
-- =====================================================================
alter table public.org_subscriptions enable row level security;
alter table public.redemption_codes enable row level security;
alter table public.redemption_code_uses enable row level security;

drop policy if exists os_read on public.org_subscriptions;
create policy os_read on public.org_subscriptions
  for select to authenticated
  using (public.can_read_org(organization_id));

drop policy if exists os_super_all on public.org_subscriptions;
create policy os_super_all on public.org_subscriptions
  for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists rc_super_all on public.redemption_codes;
create policy rc_super_all on public.redemption_codes
  for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists rcu_super_read on public.redemption_code_uses;
create policy rcu_super_read on public.redemption_code_uses
  for select to authenticated
  using (public.is_super_admin(auth.uid()) or public.can_admin_org(organization_id));

-- =====================================================================
-- 6. Helper functions
-- =====================================================================

-- Active = grandfathered, trial (not exhausted), or active/past_due with future period
create or replace function public.org_is_active(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_subscriptions s
    where s.organization_id = _org
      and (
        s.status = 'grandfathered'
        or s.status = 'trial'
        or (s.status in ('active','past_due') and (s.current_period_end is null or s.current_period_end > now()))
      )
  );
$$;

-- Trial NVR check (counts current frigate_instances rows)
create or replace function public.org_trial_can_add_nvr(_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st public.org_sub_status;
  lim int;
  cur int;
begin
  select status, trial_nvr_limit into st, lim
    from public.org_subscriptions where organization_id = _org;
  if st is null then return false; end if;
  if st <> 'trial' then return public.org_is_active(_org); end if;
  select count(*) into cur from public.frigate_instances where organization_id = _org;
  return cur < coalesce(lim, 1);
end $$;

create or replace function public.org_trial_can_send_email(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select status from public.org_subscriptions where organization_id = _org) = 'trial'
      then coalesce((select trial_emails_sent < trial_email_limit
                       from public.org_subscriptions where organization_id = _org), false)
    else public.org_is_active(_org)
  end;
$$;

-- Increment trial email counter (called by edge functions that send mail)
create or replace function public.increment_trial_email_count(_org uuid, _n int default 1)
returns void
language sql
security definer
set search_path = public
as $$
  update public.org_subscriptions
     set trial_emails_sent = trial_emails_sent + greatest(_n, 0)
   where organization_id = _org and status = 'trial';
$$;

-- Redeem a code: extends the current period by duration_days and sets status='active'
create or replace function public.redeem_code(_code text, _org uuid)
returns table(success boolean, message text, new_period_end timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.redemption_codes;
  new_end timestamptz;
  is_admin boolean;
begin
  -- Caller must be admin of the target org
  select public.is_org_admin(auth.uid(), _org) into is_admin;
  if not is_admin then
    return query select false, 'Not authorized for this organization', null::timestamptz;
    return;
  end if;

  select * into rec from public.redemption_codes where code = upper(trim(_code));
  if not found then
    return query select false, 'Invalid code', null::timestamptz;
    return;
  end if;
  if rec.expires_at is not null and rec.expires_at < now() then
    return query select false, 'Code has expired', null::timestamptz;
    return;
  end if;
  if rec.uses >= rec.max_uses then
    return query select false, 'Code already used', null::timestamptz;
    return;
  end if;

  -- Extend from greater of now() and current_period_end
  select greatest(now(), coalesce(current_period_end, now())) + (rec.duration_days || ' days')::interval
    into new_end
    from public.org_subscriptions where organization_id = _org;

  -- Ensure a row exists
  insert into public.org_subscriptions(organization_id, status)
    values(_org, 'active') on conflict (organization_id) do nothing;

  update public.org_subscriptions
     set status = 'active',
         current_period_end = new_end,
         current_period_start = coalesce(current_period_start, now()),
         updated_at = now()
   where organization_id = _org;

  update public.redemption_codes set uses = uses + 1 where id = rec.id;
  insert into public.redemption_code_uses(code_id, organization_id, redeemed_by)
    values (rec.id, _org, auth.uid());

  return query select true, 'Code redeemed', new_end;
end $$;

-- Self-signup: creates org + makes caller admin + trial subscription
create or replace function public.signup_create_trial_org(_name text, _slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_org_id uuid;
  clean_slug text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  clean_slug := lower(regexp_replace(coalesce(_slug, _name), '[^a-z0-9]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);
  if clean_slug = '' then clean_slug := 'org-' || substr(uid::text, 1, 8); end if;
  -- Ensure unique slug
  while exists(select 1 from public.organizations where slug = clean_slug) loop
    clean_slug := clean_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  end loop;

  insert into public.organizations(name, slug, created_by)
    values (coalesce(nullif(trim(_name), ''), clean_slug), clean_slug, uid)
    returning id into new_org_id;

  insert into public.organization_members(organization_id, user_id, role)
    values (new_org_id, uid, 'admin');

  insert into public.org_subscriptions(organization_id, status)
    values (new_org_id, 'trial');

  return new_org_id;
end $$;

grant execute on function public.signup_create_trial_org(text, text) to authenticated;
grant execute on function public.redeem_code(text, uuid) to authenticated;
grant execute on function public.org_is_active(uuid) to authenticated;
grant execute on function public.org_trial_can_add_nvr(uuid) to authenticated;
grant execute on function public.org_trial_can_send_email(uuid) to authenticated;