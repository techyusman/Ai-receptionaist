-- Retention and privacy. Both run as database functions with the owner's rights, because the
-- application role is deliberately unable to delete from the append-only tables.

create or replace function app.guard_order_update() returns trigger language plpgsql as $$
declare
  frozen constant text[] := array['SUBMISSION_PENDING','SUBMISSION_UNKNOWN','SUBMITTED_TO_POS',
    'POS_VISIBILITY_UNVERIFIED','RECEIVED_BY_RESTAURANT','TRANSFERRED_TO_STAFF','ABANDONED','FAILED','CANCELLED'];
begin
  -- The privacy erasure function (security definer, below) is the only caller that sets this.
  if current_setting('app.erasure', true) = 'on' then
    return new;
  end if;
  -- Customer-facing content changes bump the version, which voids any earlier confirmation.
  if (new.customer_name, new.customer_phone_e164, new.special_instructions, new.pickup_at)
       is distinct from (old.customer_name, old.customer_phone_e164, old.special_instructions, old.pickup_at)
     and new.version = old.version then
    new.version := old.version + 1;
  end if;

  if new.version <> old.version and old.local_status = any (frozen) then
    raise exception 'order % is %, its content can no longer change', old.id, old.local_status
      using errcode = 'check_violation';
  end if;

  if new.version > old.version and new.local_status = old.local_status
     and old.local_status in ('READY_FOR_CONFIRMATION','CUSTOMER_CONFIRMED') then
    new.local_status := 'DRAFT';                    -- an edit after read-back means read it back again
  end if;

  if not app.order_transition_allowed(old.local_status, new.local_status) then
    raise exception 'order % cannot go from % to %', old.id, old.local_status, new.local_status
      using errcode = 'check_violation';
  end if;

  if new.idempotency_key <> old.idempotency_key
     and old.local_status not in ('DRAFT','NEEDS_CLARIFICATION','READY_FOR_CONFIRMATION','CUSTOMER_CONFIRMED') then
    raise exception 'order % idempotency key cannot change while %', old.id, old.local_status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function app.purge_expired(p_now timestamptz default now())
returns table(transcripts bigint, events bigint, calls_anonymised bigint, oauth_states bigint, webhooks bigint, invitations bigint)
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform set_config('app.system', 'on', true);
  with d as (delete from call_transcripts t using calls c where c.id = t.call_id and c.purge_after < p_now returning 1) select count(*) into transcripts from d;
  with d as (delete from call_events e using calls c where c.id = e.call_id and c.purge_after < p_now returning 1) select count(*) into events from d;
  -- The call itself stays (outcome, duration, counts) so analytics survive; who called does not.
  with u as (update calls set from_e164 = null, caller_name = null, summary = null, recording_ref = null
              where purge_after < p_now and (from_e164 is not null or caller_name is not null or summary is not null or recording_ref is not null) returning 1)
    select count(*) into calls_anonymised from u;
  with d as (delete from oauth_states where expires_at < p_now - interval '1 day' returning 1) select count(*) into oauth_states from d;
  with d as (delete from webhook_events where received_at < p_now - interval '30 days' returning 1) select count(*) into webhooks from d;
  with d as (delete from invitations where accepted_at is null and expires_at < p_now - interval '30 days' returning 1) select count(*) into invitations from d;
  return next;
end $$;

-- "Delete everything you hold about this phone number" for one restaurant (a data request). Orders keep
-- their lines and totals (the restaurant's records) but lose who they were for.
create or replace function app.erase_person(p_restaurant uuid, p_e164 text)
returns table(calls bigint, callbacks bigint, orders bigint)
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare ids uuid[];
begin
  perform set_config('app.system', 'on', true);
  perform set_config('app.erasure', 'on', true);
  select coalesce(array_agg(id), '{}') into ids from public.calls c where c.restaurant_id = p_restaurant and c.from_e164 = p_e164;
  delete from call_transcripts where call_id = any(ids);
  with u as (update public.calls c set from_e164 = null, caller_name = null, summary = null, recording_ref = null where c.id = any(ids) returning 1) select count(*) into calls from u;
  with u as (update callback_requests set customer_name = 'Erased', phone_e164 = '+10000000000', reason = null, preferred_window = null
              where restaurant_id = p_restaurant and phone_e164 = p_e164 returning 1) select count(*) into callbacks from u;
  with u as (update public.orders o set customer_name = 'Erased', customer_phone_e164 = '+10000000000', special_instructions = null
              where o.restaurant_id = p_restaurant and o.customer_phone_e164 = p_e164 returning 1) select count(*) into orders from u;
  return next;
end $$;

revoke all on function app.purge_expired(timestamptz) from public;
revoke all on function app.erase_person(uuid, text) from public;
grant execute on function app.purge_expired(timestamptz) to app_rw;
grant execute on function app.erase_person(uuid, text) to app_rw;
