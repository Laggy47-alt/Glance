-- 1. Add 'lifetime' to org_sub_status enum
ALTER TYPE public.org_sub_status ADD VALUE IF NOT EXISTS 'lifetime';

-- 2. Add nvr_license_count to org_subscriptions
ALTER TABLE public.org_subscriptions
  ADD COLUMN IF NOT EXISTS nvr_license_count integer NOT NULL DEFAULT 0;

-- 3. Add kind + nvr_slots to redemption_codes
ALTER TABLE public.redemption_codes
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'time',
  ADD COLUMN IF NOT EXISTS nvr_slots integer NOT NULL DEFAULT 0;

ALTER TABLE public.redemption_codes
  DROP CONSTRAINT IF EXISTS redemption_codes_kind_check;
ALTER TABLE public.redemption_codes
  ADD CONSTRAINT redemption_codes_kind_check
  CHECK (kind IN ('time','lifetime','nvr_slot'));

-- 4. Update org_is_active to recognize 'lifetime' (use ::text to avoid uncommitted-enum error)
CREATE OR REPLACE FUNCTION public.org_is_active(_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.org_subscriptions s
    where s.organization_id = _org
      and (
        s.status::text = 'grandfathered'
        or s.status::text = 'lifetime'
        or s.status::text = 'trial'
        or (s.status::text in ('active','past_due') and (s.current_period_end is null or s.current_period_end > now()))
      )
  );
$function$;

-- 5. Update org_trial_can_add_nvr to include purchased NVR licenses
CREATE OR REPLACE FUNCTION public.org_trial_can_add_nvr(_org uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st text;
  lim int;
  cur int;
  lic int;
begin
  select status::text, trial_nvr_limit, nvr_license_count
    into st, lim, lic
    from public.org_subscriptions where organization_id = _org;
  if st is null then return false; end if;
  if st = 'lifetime' then return true; end if;
  if st = 'trial' then
    select count(*) into cur from public.frigate_instances where organization_id = _org;
    return cur < (coalesce(lim, 1) + coalesce(lic, 0));
  end if;
  if not public.org_is_active(_org) then return false; end if;
  if coalesce(lic, 0) > 0 then
    select count(*) into cur from public.frigate_instances where organization_id = _org;
    return cur < lic;
  end if;
  return true;
end $function$;

-- 6. Updated redeem_code: handles 'time', 'lifetime', and 'nvr_slot' kinds
CREATE OR REPLACE FUNCTION public.redeem_code(_code text, _org uuid)
 RETURNS TABLE(success boolean, message text, new_period_end timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec public.redemption_codes;
  new_end timestamptz;
  is_admin boolean;
begin
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

  insert into public.org_subscriptions(organization_id, status)
    values(_org, 'active') on conflict (organization_id) do nothing;

  if rec.kind = 'lifetime' then
    update public.org_subscriptions
       set status = 'lifetime'::public.org_sub_status,
           current_period_end = null,
           current_period_start = coalesce(current_period_start, now()),
           updated_at = now()
     where organization_id = _org;
    new_end := null;

  elsif rec.kind = 'nvr_slot' then
    update public.org_subscriptions
       set nvr_license_count = nvr_license_count + greatest(coalesce(rec.nvr_slots, 1), 1),
           status = case when status::text = 'trial' then 'active'::public.org_sub_status else status end,
           current_period_start = coalesce(current_period_start, now()),
           updated_at = now()
     where organization_id = _org
     returning current_period_end into new_end;

  else
    select greatest(now(), coalesce(current_period_end, now())) + (rec.duration_days || ' days')::interval
      into new_end
      from public.org_subscriptions where organization_id = _org;
    update public.org_subscriptions
       set status = 'active'::public.org_sub_status,
           current_period_end = new_end,
           current_period_start = coalesce(current_period_start, now()),
           updated_at = now()
     where organization_id = _org;
  end if;

  update public.redemption_codes set uses = uses + 1 where id = rec.id;
  insert into public.redemption_code_uses(code_id, organization_id, redeemed_by)
    values (rec.id, _org, auth.uid());

  return query select true,
    case rec.kind
      when 'lifetime' then 'Lifetime access activated'
      when 'nvr_slot' then 'NVR license(s) added'
      else 'Code redeemed'
    end,
    new_end;
end $function$;