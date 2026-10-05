-- Mirror of the shared ReVector payment-settings migration used by the user app.
create table if not exists public.revector_payment_settings (
  id text primary key default 'default' check (id = 'default'),
  usd_to_bdt_rate numeric(12,4) not null default 130 check (usd_to_bdt_rate > 0 and usd_to_bdt_rate <= 10000),
  bkash jsonb not null default '{"enabled":false,"number":"","instructions":["Send the exact amount to the displayed bKash number.","Keep your bKash transaction ID (TrxID) after payment.","Enter the transaction ID in ReVector and submit the request."]}'::jsonb,
  nagad jsonb not null default '{"enabled":false,"number":"","instructions":["Send the exact amount to the displayed Nagad number.","Keep your Nagad transaction ID after payment.","Enter the transaction ID in ReVector and submit the request."]}'::jsonb,
  updated_by uuid references public.revector_profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.revector_payment_settings(id) values ('default') on conflict (id) do nothing;
alter table public.revector_payment_settings enable row level security;
revoke all on public.revector_payment_settings from anon,authenticated,service_role;
grant select on public.revector_payment_settings to authenticated;
grant select,update on public.revector_payment_settings to service_role;

drop policy if exists rv_payment_settings_active_user on public.revector_payment_settings;
create policy rv_payment_settings_active_user
on public.revector_payment_settings for select to authenticated
using (exists(select 1 from public.revector_profiles p where p.id=(select auth.uid()) and p.status='ACTIVE'));

create or replace function public.rv_update_payment_settings(
  p_admin uuid,p_rate numeric,p_bkash jsonb,p_nagad jsonb
) returns public.revector_payment_settings
language plpgsql set search_path=''
as $$
declare s public.revector_payment_settings; item jsonb;
begin
  perform revector_private.require_admin(p_admin);
  if p_rate is null or p_rate<=0 or p_rate>10000 then
    raise exception 'INVALID_PAYMENT_RATE' using errcode='PT400';
  end if;
  if jsonb_typeof(p_bkash)<>'object' or jsonb_typeof(p_nagad)<>'object'
     or jsonb_typeof(p_bkash->'enabled')<>'boolean'
     or jsonb_typeof(p_nagad->'enabled')<>'boolean'
     or jsonb_typeof(p_bkash->'instructions')<>'array'
     or jsonb_typeof(p_nagad->'instructions')<>'array' then
    raise exception 'INVALID_PAYMENT_SETTINGS' using errcode='PT400';
  end if;
  if length(coalesce(p_bkash->>'number',''))>40
     or length(coalesce(p_nagad->>'number',''))>40
     or jsonb_array_length(p_bkash->'instructions')>8
     or jsonb_array_length(p_nagad->'instructions')>8 then
    raise exception 'INVALID_PAYMENT_SETTINGS' using errcode='PT400';
  end if;
  for item in select value from jsonb_array_elements(p_bkash->'instructions') loop
    if jsonb_typeof(item)<>'string' or length(trim(item #>> '{}'))>300 then
      raise exception 'INVALID_PAYMENT_SETTINGS' using errcode='PT400';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_nagad->'instructions') loop
    if jsonb_typeof(item)<>'string' or length(trim(item #>> '{}'))>300 then
      raise exception 'INVALID_PAYMENT_SETTINGS' using errcode='PT400';
    end if;
  end loop;
  update public.revector_payment_settings
    set usd_to_bdt_rate=round(p_rate::numeric,4),bkash=p_bkash,nagad=p_nagad,
        updated_by=p_admin,updated_at=now()
    where id='default' returning * into s;
  insert into public.revector_admin_audit_log(admin_user_id,action,target,reason)
    values(p_admin,'PAYMENT_SETTINGS_UPDATE','default','Updated bKash/Nagad payment configuration');
  return s;
end $$;
revoke all on function public.rv_update_payment_settings(uuid,numeric,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.rv_update_payment_settings(uuid,numeric,jsonb,jsonb) to service_role;
