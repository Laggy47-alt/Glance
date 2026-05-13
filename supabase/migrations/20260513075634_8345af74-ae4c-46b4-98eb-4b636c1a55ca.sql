
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
  has_source boolean;
  new_secret text;
  new_slug text;
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

  -- Auto-provision a default per-org webhook source if none exists yet
  select exists(select 1 from public.webhook_sources where organization_id = _org) into has_source;
  if not has_source then
    new_secret := replace(gen_random_uuid()::text, '-', '');
    new_slug := 'org-' || substr(replace(_org::text, '-', ''), 1, 8) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    insert into public.webhook_sources(name, slug, secret, color, organization_id)
      values('Default NVR Source', new_slug, new_secret, '#06b6d4', _org);
  end if;

  return query select true,
    case rec.kind
      when 'lifetime' then 'Lifetime access activated'
      when 'nvr_slot' then 'NVR license(s) added'
      else 'Code redeemed'
    end,
    new_end;
end $function$;
