-- Columns the API needs that the first migration left out.

-- Only test calls use this: a rough total when Square can't price an order. Real callers are never
-- quoted an estimate (totals come from Square CalculateOrder, FR-ORDER-007).
alter table locations
  add column estimate_tax_rate_percent numeric(5,3) not null default 0
  check (estimate_tax_rate_percent between 0 and 30);

-- Shown on the Team page.
alter table users add column last_seen_at timestamptz;

-- Set when a call ends, from the order or callback the caller gave their name for.
alter table calls add column caller_name text check (length(caller_name) <= 80);

-- Tokens and secrets for the one-time media stream handshake are signed, not stored, but the
-- Square OAuth state needs the redirect target so the callback can send the person back.
alter table oauth_states add column return_path text check (return_path ~ '^/[A-Za-z0-9/_-]*$');

-- Where an order's totals came from. A real caller is only ever read a total Square calculated.
alter table orders
  add column totals_source text check (totals_source in ('SQUARE','ESTIMATE')),
  add constraint estimate_only_for_tests check (totals_source is distinct from 'ESTIMATE' or is_test),
  add constraint totals_have_source check (total_minor is null or totals_source is not null);

-- Events written in one transaction (a submission and its result) must keep their order, so stamp
-- them with the wall clock rather than the transaction's start time.
alter table order_events alter column occurred_at set default clock_timestamp();
alter table order_events alter column created_at set default clock_timestamp();

-- Names shown on the Square page, captured when the restaurant connects and picks a location.
alter table pos_integrations add column merchant_name text;
alter table pos_integrations add column pos_location_name text;
