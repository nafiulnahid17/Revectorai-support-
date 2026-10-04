-- ReVector Control V1. No engine tables or existing application tables are changed.
create schema if not exists revector_private;
revoke all on schema revector_private from public, anon, authenticated;
grant usage on schema revector_private to service_role;

create table public.revector_profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 auth_user_id uuid not null unique references auth.users(id) on delete restrict,
 name text not null default '' check (length(name) <= 120),
 email text not null check (length(email) <= 254),
 company text not null default '' check (length(company) <= 180),
 role text not null default 'USER' check (role in ('USER','ADMIN','SUPPORT')),
 status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','DISABLED')),
 sessions_valid_after timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(id = auth_user_id)
);
create table public.revector_wallets (
 user_id uuid primary key references public.revector_profiles(id) on delete restrict,
 current_credit_balance numeric(20,4) not null default 0 check(current_credit_balance >= 0),
 reserved_credits numeric(20,4) not null default 0 check(reserved_credits >= 0 and reserved_credits <= current_credit_balance),
 updated_at timestamptz not null default now()
);
create table public.revector_wallet_transactions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.revector_profiles(id) on delete restrict,
 type text not null check(type in ('TOPUP','AI_USAGE','ADMIN_ADJUSTMENT','REFUND','REVERSAL','PROMO','OTHER')),
 credits_delta numeric(20,4) not null check(credits_delta <> 0),
 balance_after numeric(20,4) not null check(balance_after >= 0),
 reference text not null check(length(reference) <= 180),
 reason text not null check(length(reason) between 1 and 1000),
 created_by uuid references public.revector_profiles(id),
 created_at timestamptz not null default now(),
 unique(user_id, reference)
);
create table public.revector_model_catalog (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(length(provider) between 1 and 80),
 model_id text not null check(length(model_id) between 1 and 200),
 display_name text not null check(length(display_name) between 1 and 120),
 capability text not null check(capability in ('ANALYZER','IMAGE')),
 enabled boolean not null default false,
 input_price_metadata jsonb not null default '{}',
 output_price_metadata jsonb not null default '{}',
 image_price_metadata jsonb not null default '{}',
 operation_prices jsonb not null default '{}' check(jsonb_typeof(operation_prices)='object'),
 pricing_version text not null default 'UNPRICED',
 updated_at timestamptz not null default now(),
 unique(provider, model_id)
);
-- Verified identifiers, centrally catalogued. No invented pricing or activation claim.
insert into public.revector_model_catalog(provider,model_id,display_name,capability,enabled)
values ('cloudflare','@cf/meta/llama-4-scout-17b-16e-instruct','Llama 4 Scout','ANALYZER',true),
 ('cloudflare','@cf/black-forest-labs/flux-2-klein-4b','FLUX.2 Klein 4B','IMAGE',true);

create table public.revector_user_model_preferences (
 user_id uuid primary key references public.revector_profiles(id) on delete restrict,
 analyzer_model_id uuid references public.revector_model_catalog(id),
 image_model_id uuid references public.revector_model_catalog(id),
 updated_at timestamptz not null default now()
);
create table public.revector_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.revector_profiles(id) on delete restrict,
 type text not null check(type in ('TOPUP','MODEL_CHANGE','SUPPORT')),
 status text not null,
 subject text not null default '' check(length(subject)<=160),
 category text check(category in ('TECHNICAL','VECTOR_QUALITY','BILLING','CREDITS','MODEL','ACCOUNT','OTHER')),
 payload jsonb not null default '{}' check(jsonb_typeof(payload)='object'),
 admin_response text not null default '' check(length(admin_response)<=4000),
 decided_by uuid references public.revector_profiles(id),
 decision_key text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((type in ('TOPUP','MODEL_CHANGE') and status in ('PENDING','APPROVED','REJECTED','CANCELLED'))
   or (type='SUPPORT' and status in ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')))
);
create table public.revector_usage_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.revector_profiles(id) on delete restrict,
 event_key text not null check(length(event_key)<=220),
 project_id uuid,
 operation text not null check(operation in ('PREPARE','ANALYZE','IDENTIFY_PARTS','ENHANCE','MASTER_MOCKUP','RECONSTRUCT_MISSING_PART','ERROR_ASSISTANT')),
 provider text, model text,
 processing_mode text check(processing_mode in ('PRIMARY_AI','FALLBACK_AI','DETERMINISTIC')),
 status text not null check(status in ('RESERVED','SUCCEEDED','FAILED','CANCELLED')),
 provider_usage jsonb not null default '{}',
 estimated_usd_cost numeric(20,8) check(estimated_usd_cost>=0),
 credits_charged numeric(20,4) not null default 0 check(credits_charged>=0),
 pricing_version text,
 cost_source text check(cost_source in ('ACTUAL','ESTIMATED')),
 reserved_credits numeric(20,4) not null default 0 check(reserved_credits>=0),
 dispatch jsonb, dispatch_job_id uuid,
 reservation_id uuid references public.revector_usage_events(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,event_key)
);
create table public.revector_admin_audit_log (
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references public.revector_profiles(id),
 action text not null,
 target text not null,
 reason text not null,
 metadata jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index rv_transactions_user_date on public.revector_wallet_transactions(user_id,created_at desc);
create index rv_usage_user_date on public.revector_usage_events(user_id,created_at desc);
create index rv_usage_job on public.revector_usage_events(dispatch_job_id) where dispatch_job_id is not null;
create index rv_usage_reservations on public.revector_usage_events(user_id,project_id) where status='RESERVED';
create index rv_requests_user_date on public.revector_requests(user_id,created_at desc);
create index rv_requests_queue on public.revector_requests(type,status,created_at);
create index rv_audit_date on public.revector_admin_audit_log(created_at desc);

create function revector_private.touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end $$;
create trigger rv_profile_touch before update on public.revector_profiles for each row execute function revector_private.touch();
create trigger rv_preferences_touch before update on public.revector_user_model_preferences for each row execute function revector_private.touch();
create trigger rv_request_touch before update on public.revector_requests for each row execute function revector_private.touch();
create function revector_private.create_wallet() returns trigger language plpgsql set search_path='' as $$
begin insert into public.revector_wallets(user_id) values(new.id); return new; end $$;
create trigger rv_profile_wallet after insert on public.revector_profiles for each row execute function revector_private.create_wallet();
create function revector_private.immutable_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Accounting and audit history is append-only'; end $$;
create trigger rv_ledger_immutable before update or delete on public.revector_wallet_transactions for each row execute function revector_private.immutable_history();
create trigger rv_audit_immutable before update or delete on public.revector_admin_audit_log for each row execute function revector_private.immutable_history();

alter table public.revector_profiles enable row level security;
alter table public.revector_wallets enable row level security;
alter table public.revector_wallet_transactions enable row level security;
alter table public.revector_usage_events enable row level security;
alter table public.revector_model_catalog enable row level security;
alter table public.revector_user_model_preferences enable row level security;
alter table public.revector_requests enable row level security;
alter table public.revector_admin_audit_log enable row level security;
revoke all on public.revector_profiles,public.revector_wallets,public.revector_wallet_transactions,
 public.revector_usage_events,public.revector_model_catalog,public.revector_user_model_preferences,
 public.revector_requests,public.revector_admin_audit_log from anon,authenticated;
grant select on public.revector_profiles,public.revector_wallets,public.revector_wallet_transactions,
 public.revector_usage_events,public.revector_model_catalog,public.revector_user_model_preferences,
 public.revector_requests to authenticated;
grant update(name,company) on public.revector_profiles to authenticated;
revoke all on public.revector_profiles,public.revector_wallets,public.revector_wallet_transactions,
 public.revector_usage_events,public.revector_model_catalog,public.revector_user_model_preferences,
 public.revector_requests,public.revector_admin_audit_log from service_role;
grant select,insert,update on public.revector_profiles,public.revector_wallets,
 public.revector_usage_events,public.revector_model_catalog,public.revector_user_model_preferences,
 public.revector_requests to service_role;
grant select,insert on public.revector_wallet_transactions,public.revector_admin_audit_log to service_role;
create policy rv_profile_own on public.revector_profiles for select to authenticated using(id=(select auth.uid()));
create policy rv_profile_edit on public.revector_profiles for update to authenticated using(id=(select auth.uid()) and status='ACTIVE') with check(id=(select auth.uid()) and status='ACTIVE');
create policy rv_wallet_own on public.revector_wallets for select to authenticated using(user_id=(select auth.uid()));
create policy rv_ledger_own on public.revector_wallet_transactions for select to authenticated using(user_id=(select auth.uid()));
create policy rv_usage_own on public.revector_usage_events for select to authenticated using(user_id=(select auth.uid()));
create policy rv_model_enabled on public.revector_model_catalog for select to authenticated using(enabled);
create policy rv_preference_own on public.revector_user_model_preferences for select to authenticated using(user_id=(select auth.uid()));
create policy rv_request_own on public.revector_requests for select to authenticated using(user_id=(select auth.uid()));

-- Invoker functions. Only the trusted Worker service role can execute financial RPCs.
create function revector_private.require_active(p_user uuid) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.revector_profiles where id=p_user and status='ACTIVE')
 then raise exception 'ACCOUNT_NOT_ACTIVE' using errcode='PT403'; end if;
end $$;
create function revector_private.require_admin(p_admin uuid) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.revector_profiles where id=p_admin and status='ACTIVE' and role='ADMIN')
 then raise exception 'ADMIN_REQUIRED' using errcode='PT403'; end if;
end $$;
create function revector_private.apply_wallet(p_user uuid,p_delta numeric,p_type text,p_reference text,p_reason text,p_actor uuid)
returns public.revector_wallet_transactions language plpgsql set search_path='' as $$
declare w public.revector_wallets; t public.revector_wallet_transactions;
begin
 select * into w from public.revector_wallets where user_id=p_user for update;
 if not found then raise exception 'WALLET_NOT_FOUND' using errcode='PT404'; end if;
 select * into t from public.revector_wallet_transactions where user_id=p_user and reference=p_reference;
 if found then
  if t.credits_delta<>p_delta or t.type<>p_type or t.created_by is distinct from p_actor or t.reason<>p_reason then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='PT409'; end if;
  return t;
 end if;
 if p_delta=0 or abs(p_delta)>1000000 or length(trim(p_reason))=0 then raise exception 'INVALID_ADJUSTMENT' using errcode='PT400'; end if;
 if w.current_credit_balance+p_delta<w.reserved_credits then raise exception 'INSUFFICIENT_CREDITS' using errcode='PT402'; end if;
 update public.revector_wallets set current_credit_balance=current_credit_balance+p_delta,updated_at=now() where user_id=p_user returning * into w;
 insert into public.revector_wallet_transactions(user_id,type,credits_delta,balance_after,reference,reason,created_by)
 values(p_user,p_type,p_delta,w.current_credit_balance,p_reference,p_reason,p_actor) returning * into t;
 return t;
end $$;
create function public.rv_adjust_wallet(p_admin uuid,p_user uuid,p_delta numeric,p_reason text,p_key text)
returns public.revector_wallet_transactions language plpgsql set search_path='' as $$
declare t public.revector_wallet_transactions; existed boolean;
begin
 perform revector_private.require_admin(p_admin);
 perform 1 from public.revector_wallets where user_id=p_user for update;
 select exists(select 1 from public.revector_wallet_transactions where user_id=p_user and reference='admin:'||p_key) into existed;
 t=revector_private.apply_wallet(p_user,p_delta,'ADMIN_ADJUSTMENT','admin:'||p_key,p_reason,p_admin);
 if not existed then insert into public.revector_admin_audit_log(admin_user_id,action,target,reason,metadata)
 values(p_admin,'WALLET_ADJUSTMENT',p_user::text,p_reason,jsonb_build_object('transaction_id',t.id,'credits_delta',p_delta)); end if;
 return t;
end $$;
create function public.rv_decide_request(p_admin uuid,p_request uuid,p_decision text,p_response text,p_key text,p_model uuid default null)
returns public.revector_requests language plpgsql set search_path='' as $$
declare r public.revector_requests; t public.revector_wallet_transactions; m public.revector_model_catalog;
begin
 perform revector_private.require_admin(p_admin);
 select * into r from public.revector_requests where id=p_request for update;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='PT404'; end if;
 if r.status<>'PENDING' then
  if r.decision_key=p_key and r.status=p_decision then return r; end if;
  raise exception 'REQUEST_ALREADY_DECIDED' using errcode='PT409';
 end if;
 if p_decision not in ('APPROVED','REJECTED') or r.type='SUPPORT' then raise exception 'INVALID_DECISION' using errcode='PT400'; end if;
 if p_decision='APPROVED' and r.type='TOPUP' then
  perform revector_private.require_active(r.user_id);
  if (r.payload->>'requested_credits')::numeric<=0 then raise exception 'INVALID_TOPUP'; end if;
  t=revector_private.apply_wallet(r.user_id,(r.payload->>'requested_credits')::numeric,'TOPUP','topup:'||r.id::text,coalesce(nullif(p_response,''),'Approved top-up request'),p_admin);
 elsif p_decision='APPROVED' and r.type='MODEL_CHANGE' then
  perform revector_private.require_active(r.user_id);
  select * into m from public.revector_model_catalog where id=coalesce(p_model,(r.payload->>'model_id')::uuid) and enabled;
  if not found or m.capability<>r.payload->>'capability' then raise exception 'MODEL_UNAVAILABLE' using errcode='PT400'; end if;
  insert into public.revector_user_model_preferences(user_id,analyzer_model_id,image_model_id)
  values(r.user_id,case when m.capability='ANALYZER' then m.id end,case when m.capability='IMAGE' then m.id end)
  on conflict(user_id) do update set
   analyzer_model_id=case when m.capability='ANALYZER' then m.id else revector_user_model_preferences.analyzer_model_id end,
   image_model_id=case when m.capability='IMAGE' then m.id else revector_user_model_preferences.image_model_id end;
 end if;
 update public.revector_requests set status=p_decision,admin_response=p_response,decided_by=p_admin,decision_key=p_key where id=r.id returning * into r;
 insert into public.revector_admin_audit_log(admin_user_id,action,target,reason,metadata)
 values(p_admin,r.type||'_'||p_decision,r.id::text,coalesce(nullif(p_response,''),'Request reviewed'),jsonb_build_object('user_id',r.user_id,'transaction_id',t.id));
 return r;
end $$;
create function public.rv_set_preferences(p_user uuid,p_analyzer uuid,p_image uuid)
returns public.revector_user_model_preferences language plpgsql set search_path='' as $$
declare r public.revector_user_model_preferences;
begin
 perform revector_private.require_active(p_user);
 if p_analyzer is not null and not exists(select 1 from public.revector_model_catalog where id=p_analyzer and enabled and capability='ANALYZER')
 or p_image is not null and not exists(select 1 from public.revector_model_catalog where id=p_image and enabled and capability='IMAGE')
 then raise exception 'MODEL_UNAVAILABLE' using errcode='PT400'; end if;
 insert into public.revector_user_model_preferences(user_id,analyzer_model_id,image_model_id) values(p_user,p_analyzer,p_image)
 on conflict(user_id) do update set analyzer_model_id=excluded.analyzer_model_id,image_model_id=excluded.image_model_id returning * into r;
 return r;
end $$;
create function public.rv_set_account_status(p_admin uuid,p_user uuid,p_status text,p_reason text)
returns public.revector_profiles language plpgsql set search_path='' as $$
declare p public.revector_profiles;
begin
 perform revector_private.require_admin(p_admin);
 if p_user=p_admin or p_status not in ('ACTIVE','SUSPENDED','DISABLED') or length(trim(p_reason))=0 then raise exception 'INVALID_STATUS_CHANGE' using errcode='PT400'; end if;
 update public.revector_profiles set status=p_status where id=p_user returning * into p;
 if not found then raise exception 'USER_NOT_FOUND' using errcode='PT404'; end if;
 insert into public.revector_admin_audit_log(admin_user_id,action,target,reason) values(p_admin,'ACCOUNT_'||p_status,p_user::text,p_reason);
 return p;
end $$;
create function revector_private.require_support(p_admin uuid) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.revector_profiles where id=p_admin and status='ACTIVE' and role in ('ADMIN','SUPPORT')) then raise exception 'SUPPORT_REQUIRED' using errcode='PT403';end if;
end $$;
create table public.revector_support_messages (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.revector_requests(id),
 author_id uuid not null references public.revector_profiles(id), author_role text not null check(author_role in ('USER','ADMIN','SUPPORT')),
 message text not null check(length(message) between 1 and 4000), created_at timestamptz not null default now()
);
create index rv_messages_ticket_date on public.revector_support_messages(request_id,created_at);
alter table public.revector_support_messages enable row level security;
revoke all on public.revector_support_messages from anon,authenticated;
grant select on public.revector_support_messages to authenticated;
revoke all on public.revector_support_messages from service_role;
grant select,insert on public.revector_support_messages to service_role;
create policy rv_messages_own on public.revector_support_messages for select to authenticated using(exists(select 1 from public.revector_requests r where r.id=request_id and r.user_id=(select auth.uid())));
create trigger rv_messages_immutable before update or delete on public.revector_support_messages for each row execute function revector_private.immutable_history();
create function public.rv_reply_support(p_admin uuid,p_request uuid,p_response text,p_status text)
returns public.revector_requests language plpgsql set search_path='' as $$
declare r public.revector_requests;
begin
 perform revector_private.require_support(p_admin);
 if p_status not in ('OPEN','IN_PROGRESS','RESOLVED','CLOSED') or length(trim(p_response))=0 then raise exception 'INVALID_SUPPORT_REPLY' using errcode='PT400'; end if;
 update public.revector_requests set admin_response=p_response,status=p_status,decided_by=p_admin where id=p_request and type='SUPPORT' returning * into r;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='PT404'; end if;
 insert into public.revector_support_messages(request_id,author_id,author_role,message) select p_request,p_admin,role,p_response from public.revector_profiles where id=p_admin;
 insert into public.revector_admin_audit_log(admin_user_id,action,target,reason) values(p_admin,'SUPPORT_'||p_status,p_request::text,p_response);
 return r;
end $$;
create function public.rv_reserve_operation(p_user uuid,p_key text,p_operation text,p_project uuid,p_conversion numeric)
returns jsonb language plpgsql set search_path='' as $$
declare r public.revector_usage_events; quote numeric; usd_quote numeric; models jsonb; w public.revector_wallets;
begin
 perform revector_private.require_active(p_user);
 select * into w from public.revector_wallets where user_id=p_user for update;
 select * into r from public.revector_usage_events where user_id=p_user and event_key='request:'||p_key;
 if found then
  if r.operation<>p_operation or r.project_id is distinct from p_project then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='PT409'; end if;
  if r.dispatch is not null then return jsonb_build_object('id',r.id,'replayed',true,'dispatch',r.dispatch); end if;
  raise exception 'OPERATION_IN_PROGRESS' using errcode='PT409';
 end if;
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') into models from public.revector_model_catalog m where enabled;
 select coalesce(sum(price),0),coalesce(sum(ceil(price*coalesce(p_conversion,0))),0) into usd_quote,quote from (
  select operation, max((value)::numeric) price
  from jsonb_array_elements(models) as snapshot(entry),
   lateral jsonb_populate_record(null::public.revector_model_catalog,entry) m,
   lateral jsonb_each_text(m.operation_prices) prices(operation,value)
  where enabled and operation in (select unnest(case when p_operation='PREPARE' then array['ANALYZE','ENHANCE','MASTER_MOCKUP','IDENTIFY_PARTS'] else array[p_operation] end))
  group by operation
 ) costs;
 if usd_quote>0 and (p_conversion is null or p_conversion<=0) then raise exception 'PRICING_NOT_CONFIGURED' using errcode='PT503'; end if;
 if w.current_credit_balance-w.reserved_credits<quote then raise exception 'INSUFFICIENT_CREDITS' using errcode='PT402'; end if;
 update public.revector_wallets set reserved_credits=reserved_credits+quote,updated_at=now() where user_id=p_user;
 insert into public.revector_usage_events(user_id,event_key,project_id,operation,status,reserved_credits,provider_usage)
 values(p_user,'request:'||p_key,p_project,p_operation,'RESERVED',quote,jsonb_build_object('credits_per_usd',p_conversion,'pricing_snapshot',models)) returning * into r;
 return jsonb_build_object('id',r.id,'replayed',false,'reserved_credits',quote);
end $$;
create function public.rv_bind_operation(p_user uuid,p_id uuid,p_dispatch jsonb,p_job uuid)
returns void language plpgsql set search_path='' as $$
begin
 update public.revector_usage_events set dispatch=p_dispatch,dispatch_job_id=p_job,updated_at=now()
 where id=p_id and user_id=p_user and status='RESERVED';
 if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode='PT404'; end if;
end $$;
create function public.rv_finish_reservation(p_user uuid,p_id uuid,p_status text)
returns void language plpgsql set search_path='' as $$
declare r public.revector_usage_events;
begin
 if p_status not in ('SUCCEEDED','FAILED','CANCELLED') then raise exception 'INVALID_STATUS'; end if;
 perform 1 from public.revector_wallets where user_id=p_user for update;
 select * into r from public.revector_usage_events where id=p_id and user_id=p_user for update;
 if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode='PT404'; end if;
 if r.status<>'RESERVED' then return; end if;
 update public.revector_wallets set reserved_credits=reserved_credits-r.reserved_credits,updated_at=now() where user_id=p_user;
 update public.revector_usage_events set reserved_credits=0,status=p_status,updated_at=now() where id=r.id;
end $$;
create function public.rv_record_usage(p_user uuid,p_event_key text,p_project uuid,p_operation text,p_provider text,p_model text,p_mode text,p_status text,p_usage jsonb,p_actual_cost numeric,p_reservation uuid,p_conversion numeric)
returns public.revector_usage_events language plpgsql set search_path='' as $$
declare r public.revector_usage_events; reservation public.revector_usage_events; w public.revector_wallets;
 m public.revector_model_catalog; cost numeric; credits numeric:=0; held numeric:=0; source text;
begin
 perform 1 from public.revector_wallets where user_id=p_user for update;
 select * into r from public.revector_usage_events where user_id=p_user and event_key=p_event_key;
 if found then
  if r.project_id is distinct from p_project or r.operation<>p_operation or r.provider is distinct from p_provider or r.model is distinct from p_model or r.status<>p_status then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='PT409';end if;
  return r; end if;
 if p_status not in ('SUCCEEDED','FAILED') or (p_mode is not null and p_mode not in ('PRIMARY_AI','FALLBACK_AI','DETERMINISTIC')) then raise exception 'INVALID_USAGE'; end if;
 if p_mode='DETERMINISTIC' and (p_model is not null or p_provider is not null or p_actual_cost is not null) then raise exception 'INVALID_DETERMINISTIC_COST'; end if;
 if p_reservation is not null then
  select * into reservation from public.revector_usage_events where id=p_reservation and user_id=p_user and status='RESERVED' for update;
 end if;
 if reservation.id is not null then
  select catalog.* into m from jsonb_array_elements(reservation.provider_usage->'pricing_snapshot') as snapshot(entry), lateral jsonb_populate_record(null::public.revector_model_catalog,entry) catalog where catalog.provider=p_provider and catalog.model_id=p_model;
  p_conversion=coalesce((reservation.provider_usage->>'credits_per_usd')::numeric,p_conversion);
 else
  select * into m from public.revector_model_catalog where provider=p_provider and model_id=p_model;
 end if;
 if p_mode<>'DETERMINISTIC' then
  if p_actual_cost is not null then cost=p_actual_cost;source='ACTUAL';
  elsif m.operation_prices ? p_operation then cost=(m.operation_prices->>p_operation)::numeric;source='ESTIMATED';end if;
 end if;
 if cost<0 or cost>1000000 then raise exception 'INVALID_COST'; end if;
 if p_status='SUCCEEDED' and cost>0 then
  if p_conversion is null or p_conversion<=0 then raise exception 'PRICING_NOT_CONFIGURED' using errcode='PT503'; end if;
  credits=ceil(cost*p_conversion);
 end if;
 if p_reservation is not null then
  select * into reservation from public.revector_usage_events where id=p_reservation and user_id=p_user and status='RESERVED' for update;
  if found then held=least(credits,reservation.reserved_credits); end if;
 end if;
 select * into w from public.revector_wallets where user_id=p_user;
 if w.current_credit_balance-w.reserved_credits+held<credits then raise exception 'INSUFFICIENT_CREDITS' using errcode='PT402'; end if;
 if held>0 then
  update public.revector_wallets set reserved_credits=reserved_credits-held where user_id=p_user;
  update public.revector_usage_events set reserved_credits=reserved_credits-held,updated_at=now() where id=p_reservation;
 end if;
 insert into public.revector_usage_events(user_id,event_key,project_id,operation,provider,model,processing_mode,status,provider_usage,estimated_usd_cost,credits_charged,pricing_version,cost_source,reservation_id)
 values(p_user,p_event_key,p_project,p_operation,p_provider,p_model,p_mode,p_status,p_usage,cost,credits,m.pricing_version,source,p_reservation) returning * into r;
 if credits>0 then perform revector_private.apply_wallet(p_user,-credits,'AI_USAGE','usage:'||r.id::text,'Successful '||p_operation,null); end if;
 return r;
end $$;
create function public.rv_admin_overview(p_admin uuid) returns jsonb language plpgsql set search_path='' as $$
begin
 perform revector_private.require_admin(p_admin);
 return jsonb_build_object('total_users',(select count(*) from public.revector_profiles),
 'active_accounts',(select count(*) from public.revector_profiles where status='ACTIVE'),
 'credits_used',(select coalesce(sum(credits_charged),0) from public.revector_usage_events),
 'pending_topups',(select count(*) from public.revector_requests where type='TOPUP' and status='PENDING'),
 'open_support',(select count(*) from public.revector_requests where type='SUPPORT' and status in ('OPEN','IN_PROGRESS')),
 'failed_usage_events',(select count(*) from public.revector_usage_events where status='FAILED' and event_key not like 'request:%'),
 'actual_reported_ai_cost_usd',(select sum(estimated_usd_cost) from public.revector_usage_events where cost_source='ACTUAL'),
 'estimated_ai_cost_usd',(select sum(estimated_usd_cost) from public.revector_usage_events where cost_source='ESTIMATED'),
 'usage_without_cost',(select count(*) from public.revector_usage_events where estimated_usd_cost is null and event_key not like 'request:%'),
 'resolved_support',(select count(*) from public.revector_requests where type='SUPPORT' and status='RESOLVED'),
 'model_requests',(select count(*) from public.revector_requests where type='MODEL_CHANGE' and status='PENDING'));
end $$;
-- Never rely on the default PUBLIC function EXECUTE grant.
revoke all on all functions in schema revector_private from public,anon,authenticated;
grant execute on all functions in schema revector_private to service_role;
revoke all on function public.rv_adjust_wallet(uuid,uuid,numeric,text,text),public.rv_decide_request(uuid,uuid,text,text,text,uuid),
 public.rv_set_preferences(uuid,uuid,uuid),public.rv_set_account_status(uuid,uuid,text,text),public.rv_reply_support(uuid,uuid,text,text),
 public.rv_reserve_operation(uuid,text,text,uuid,numeric),public.rv_bind_operation(uuid,uuid,jsonb,uuid),
 public.rv_finish_reservation(uuid,uuid,text),public.rv_record_usage(uuid,text,uuid,text,text,text,text,text,jsonb,numeric,uuid,numeric),
 public.rv_admin_overview(uuid) from public,anon,authenticated;
grant execute on function public.rv_adjust_wallet(uuid,uuid,numeric,text,text),public.rv_decide_request(uuid,uuid,text,text,text,uuid),
 public.rv_set_preferences(uuid,uuid,uuid),public.rv_set_account_status(uuid,uuid,text,text),public.rv_reply_support(uuid,uuid,text,text),
 public.rv_reserve_operation(uuid,text,text,uuid,numeric),public.rv_bind_operation(uuid,uuid,jsonb,uuid),
 public.rv_finish_reservation(uuid,uuid,text),public.rv_record_usage(uuid,text,uuid,text,text,text,text,text,jsonb,numeric,uuid,numeric),
 public.rv_admin_overview(uuid) to service_role;
create function public.rv_user_support_message(p_user uuid,p_request uuid,p_message text) returns public.revector_support_messages language plpgsql set search_path='' as $$
declare m public.revector_support_messages;
begin
 perform revector_private.require_active(p_user);
 perform 1 from public.revector_requests where id=p_request and user_id=p_user and type='SUPPORT' and status<>'CLOSED' for update;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='PT404';end if;
 insert into public.revector_support_messages(request_id,author_id,author_role,message) values(p_request,p_user,'USER',p_message) returning * into m;
 update public.revector_requests set status='OPEN' where id=p_request;
 return m;
end $$;
create function public.rv_update_catalog(p_admin uuid,p_id uuid,p_enabled boolean,p_prices jsonb,p_version text,p_reason text) returns public.revector_model_catalog language plpgsql set search_path='' as $$
declare m public.revector_model_catalog; entry record;
begin
 perform revector_private.require_admin(p_admin);
 if jsonb_typeof(p_prices)<>'object' or length(trim(p_version))=0 or length(trim(p_reason))=0 then raise exception 'INVALID_PRICING';end if;
 for entry in select * from jsonb_each_text(p_prices) loop
  if entry.key not in ('ANALYZE','IDENTIFY_PARTS','ENHANCE','MASTER_MOCKUP','RECONSTRUCT_MISSING_PART','ERROR_ASSISTANT') or entry.value::numeric<0 or entry.value::numeric>1000 then raise exception 'INVALID_PRICING';end if;
 end loop;
 update public.revector_model_catalog set enabled=p_enabled,operation_prices=p_prices,pricing_version=p_version,updated_at=now() where id=p_id returning * into m;
 if not found then raise exception 'MODEL_UNAVAILABLE';end if;
 insert into public.revector_admin_audit_log(admin_user_id,action,target,reason,metadata) values(p_admin,'MODEL_CATALOG_UPDATED',p_id::text,p_reason,jsonb_build_object('pricing_version',p_version,'enabled',p_enabled));
 return m;
end $$;
revoke all on function public.rv_user_support_message(uuid,uuid,text),public.rv_update_catalog(uuid,uuid,boolean,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.rv_user_support_message(uuid,uuid,text),public.rv_update_catalog(uuid,uuid,boolean,jsonb,text,text) to service_role;
create function public.rv_reply_request(p_admin uuid,p_request uuid,p_response text) returns public.revector_requests language plpgsql set search_path='' as $$
declare r public.revector_requests;
begin
 perform revector_private.require_admin(p_admin);
 if length(trim(p_response))=0 then raise exception 'INVALID_RESPONSE' using errcode='PT400';end if;
 update public.revector_requests set admin_response=p_response,decided_by=p_admin where id=p_request and type in ('TOPUP','MODEL_CHANGE') returning * into r;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='PT404';end if;
 insert into public.revector_admin_audit_log(admin_user_id,action,target,reason) values(p_admin,'REQUEST_REPLY',p_request::text,p_response);
 return r;
end $$;
revoke all on function public.rv_reply_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rv_reply_request(uuid,uuid,text) to service_role;
