-- AI receptionist: first migration (Postgres 15+; Supabase-compatible)
--
-- Conventions
--   * uuid primary keys, timestamptz stored in UTC, money as bigint minor units + currency
--   * status columns are text + check constraints (easier to extend than enum types)
--   * every tenant-owned row carries restaurant_id; child rows use composite foreign keys
--     (parent_id, restaurant_id) so a row can never point at another tenant's parent
--   * access: every query goes through the tenant-scoped data layer, and row level security
--     is the backstop. The API connects as a member of app_rw and, per transaction, runs
--       select set_config('app.restaurant_id', $1, true), set_config('app.user_id', $2, true);
--     Cross-tenant system work (webhook ingress, tenant resolution, schedulers) goes through one
--     data-layer helper, withSystem(), which sets app.system = 'on' for that transaction only.
--   * on delete: config and menu rows cascade with their location; calls and orders RESTRICT
--     (business records are purged by the retention / offboarding job, never by accident)

create extension if not exists pg_trgm;           -- fuzzy menu, alias and FAQ search (gen_random_uuid is core)

create schema if not exists app;

create or replace function app.current_restaurant_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.restaurant_id', true), '')::uuid $$;

create or replace function app.current_user_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app.is_system() returns boolean
  language sql stable as $$ select coalesce(current_setting('app.system', true), '') = 'on' $$;

create or replace function app.set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Tenancy and people
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key,                         -- the auth provider's subject (Supabase auth.users.id)
  email text not null,
  display_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED','SUSPENDED')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  timezone text not null check (timezone <> ''),            -- IANA name, validated in the app
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'en-US',
  address_line1 text, address_line2 text, city text, region text, postal_code text,
  country char(2),
  directions text,
  public_phone_e164 text check (public_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  website text,
  status text not null default 'SETUP' check (status in ('SETUP','LIVE','PAUSED')),
  -- The P0 Square question lives here. Square ordering cannot be switched on until the
  -- unpaid-order test has passed and been signed off; the fallback needs written approval.
  ordering_mode text not null default 'DISABLED'
    check (ordering_mode in ('DISABLED','DASHBOARD_TICKET','SQUARE')),
  pos_feasibility text not null default 'UNVERIFIED'
    check (pos_feasibility in ('UNVERIFIED','VERIFIED_NATIVE','FALLBACK_APPROVED','BLOCKED')),
  pos_feasibility_note text,
  pos_feasibility_signed_off_by uuid references users(id) on delete set null,
  pos_feasibility_signed_off_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  constraint square_mode_needs_proof
    check (ordering_mode <> 'SQUARE' or pos_feasibility = 'VERIFIED_NATIVE'),
  constraint ticket_mode_needs_approval
    check (ordering_mode <> 'DASHBOARD_TICKET' or pos_feasibility in ('VERIFIED_NATIVE','FALLBACK_APPROVED'))
);
create index locations_restaurant_idx on locations (restaurant_id);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  location_id uuid,                                          -- null = every location
  role text not null check (role in ('OWNER','MANAGER','STAFF','SUPPORT_LIMITED')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  invited_by uuid references users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  constraint revoked_has_time check (status <> 'REVOKED' or revoked_at is not null)
);
create unique index memberships_one_per_scope on memberships
  (restaurant_id, user_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'ACTIVE';
create unique index memberships_one_owner on memberships (restaurant_id)
  where role = 'OWNER' and status = 'ACTIVE';
create index memberships_user_idx on memberships (user_id) where status = 'ACTIVE';
create index memberships_location_idx on memberships (location_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  location_id uuid,
  email text not null,
  role text not null check (role in ('MANAGER','STAFF')),     -- ownership moves by a separate audited action
  token_hash bytea not null unique,                           -- sha256 of the emailed token
  invited_by uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade
);
create unique index invitations_open_per_email on invitations (restaurant_id, lower(email))
  where accepted_at is null and revoked_at is null;
create index invitations_location_idx on invitations (location_id);
create index invitations_invited_by_idx on invitations (invited_by);

create table support_access_grants (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  support_user_id uuid not null references users(id) on delete cascade,
  granted_by uuid not null references users(id) on delete cascade,   -- an OWNER of this restaurant
  reason text not null check (length(reason) >= 10),
  scope text not null default 'READ_METADATA'
    check (scope in ('READ_METADATA','READ_CALL_CONTENT','WRITE_CONFIG')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grant_expires_after_creation check (expires_at > created_at)
);
create index support_grants_lookup_idx on support_access_grants (support_user_id, restaurant_id)
  where revoked_at is null;
create index support_grants_restaurant_idx on support_access_grants (restaurant_id);
create index support_grants_granted_by_idx on support_access_grants (granted_by);

-- ---------------------------------------------------------------------------
-- Location configuration: agent, phone, hours, knowledge
-- ---------------------------------------------------------------------------

create table location_settings (
  location_id uuid primary key,
  restaurant_id uuid not null,
  greeting text not null
    default 'Thanks for calling. I''m the restaurant''s AI receptionist. How can I help?'
    check (length(greeting) between 10 and 400),
  voice text not null default 'default',
  primary_language text not null default 'en',
  extra_languages text[] not null default '{}' check (cardinality(extra_languages) <= 1),
  ordering_enabled boolean not null default false,
  pickup_notes_enabled boolean not null default true,
  scheduled_pickup_enabled boolean not null default false,
  pickup_policy text check (length(pickup_policy) <= 1000),
  pickup_estimate_minutes int check (pickup_estimate_minutes between 1 and 240),  -- null = never quote one
  after_hours_mode text not null default 'INFO_ONLY'
    check (after_hours_mode in ('INFO_ONLY','TAKE_CALLBACK','TRANSFER_FALLBACK')),
  ring_staff_first boolean not null default false,
  ring_staff_seconds int not null default 20 check (ring_staff_seconds between 5 and 60),
  transfer_strategy text not null default 'DIRECT' check (transfer_strategy in ('DIRECT','WARM')),
  transfer_timeout_seconds int not null default 25 check (transfer_timeout_seconds between 10 and 60),
  max_transfer_attempts int not null default 2 check (max_transfer_attempts between 1 and 5),
  max_call_seconds int not null default 900 check (max_call_seconds between 120 and 3600),
  silence_timeout_seconds int not null default 12 check (silence_timeout_seconds between 5 and 60),
  max_clarification_retries int not null default 2 check (max_clarification_retries between 1 and 5),
  menu_stale_max_age_seconds int not null default 3600 check (menu_stale_max_age_seconds >= 60),
  recording_enabled boolean not null default false,
  transcript_enabled boolean not null default false,
  retention_days int not null default 90 check (retention_days between 1 and 730),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade
);
create index location_settings_restaurant_idx on location_settings (restaurant_id);

-- Numbers we own at Twilio. Transfer destinations live in transfer_targets.
create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  provider text not null default 'TWILIO' check (provider in ('TWILIO')),
  provider_sid text not null unique,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  purpose text not null default 'AI_INBOUND' check (purpose in ('AI_INBOUND','TEST')),
  enabled boolean not null default true,
  fallback_e164 text check (fallback_e164 ~ '^\+[1-9][0-9]{6,14}$'),  -- dialled by Twilio if our server is down
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade
);
create unique index phone_numbers_route_key on phone_numbers (e164) where enabled;  -- one tenant per called number
create index phone_numbers_location_idx on phone_numbers (location_id);

create table transfer_targets (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  label text not null check (length(label) between 1 and 60),
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  priority smallint not null default 1 check (priority between 1 and 9),        -- 1 = primary
  intent text not null default 'GENERAL'
    check (intent in ('GENERAL','CATERING','LARGE_PARTY','COMPLAINT','ALLERGEN')),
  active_hours text not null default 'BUSINESS_HOURS' check (active_hours in ('ALWAYS','BUSINESS_HOURS')),
  sms_alert_on_miss boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade
);
create index transfer_targets_route_idx on transfer_targets (location_id, intent, priority) where enabled;
create index transfer_targets_restaurant_idx on transfer_targets (restaurant_id);

create table business_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  kind text not null default 'STORE' check (kind in ('STORE','ORDERING')),
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday, in the location's time zone
  opens_at time not null,
  closes_at time not null,                                       -- closes_at < opens_at = ends after midnight
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  constraint not_zero_length check (opens_at <> closes_at)
);
create index business_hours_lookup_idx on business_hours (location_id, kind, weekday);
create index business_hours_restaurant_idx on business_hours (restaurant_id);

create table special_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  on_date date not null,                                         -- local date
  closed boolean not null default false,
  opens_at time,
  closes_at time,
  note text check (length(note) <= 200),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  constraint closed_or_hours check (
    (closed and opens_at is null and closes_at is null)
    or (not closed and opens_at is not null and closes_at is not null and opens_at <> closes_at))
);
create index special_hours_lookup_idx on special_hours (location_id, on_date);
create unique index special_hours_one_closure on special_hours (location_id, on_date) where closed;
create index special_hours_restaurant_idx on special_hours (restaurant_id);

create table notices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  message text not null check (length(message) between 1 and 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  constraint notice_window check (ends_at > starts_at)
);
create index notices_active_idx on notices (location_id, ends_at);
create index notices_restaurant_idx on notices (restaurant_id);

create table faqs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  question text not null check (length(question) between 3 and 300),
  question_aliases text[] not null default '{}',
  answer text not null check (length(answer) between 1 and 2000),
  active boolean not null default true,
  valid_from timestamptz,
  valid_until timestamptz,
  source text not null default 'MANUAL' check (source in ('MANUAL','TEMPLATE','GENERATED')),
  reviewed boolean not null default true,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  constraint faq_window check (valid_until is null or valid_from is null or valid_until > valid_from),
  constraint generated_needs_review check (source <> 'GENERATED' or reviewed or not active)
);
create index faqs_active_idx on faqs (location_id) where active;
create index faqs_question_trgm on faqs using gin (lower(question) gin_trgm_ops);
create index faqs_restaurant_idx on faqs (restaurant_id);

create table pronunciations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  term text not null check (length(term) between 1 and 80),
  spoken_as text not null check (length(spoken_as) between 1 and 120),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade
);
create unique index pronunciations_term_key on pronunciations (location_id, lower(term));
create index pronunciations_restaurant_idx on pronunciations (restaurant_id);

-- ---------------------------------------------------------------------------
-- Square connection and menu read model
-- ---------------------------------------------------------------------------

create table pos_integrations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  provider text not null default 'SQUARE' check (provider in ('SQUARE')),
  environment text not null check (environment in ('SANDBOX','PRODUCTION')),
  merchant_id text not null,
  pos_location_id text,                          -- the chosen Square location; null until picked
  access_token_ct bytea,                         -- AES-256-GCM (nonce || ciphertext || tag)
  refresh_token_ct bytea,
  key_version smallint not null default 1,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'CONNECTED'
    check (status in ('CONNECTED','NEEDS_REAUTH','REVOKED','DISCONNECTED')),
  last_success_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  connected_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  constraint tokens_when_connected
    check (status <> 'CONNECTED' or (access_token_ct is not null and refresh_token_ct is not null))
);
create unique index pos_integrations_one_live on pos_integrations (location_id) where status <> 'DISCONNECTED';
-- Two tenants can never claim the same Square location.
create unique index pos_integrations_claim on pos_integrations (provider, environment, merchant_id, pos_location_id)
  where status = 'CONNECTED' and pos_location_id is not null;
create index pos_integrations_refresh_idx on pos_integrations (status, token_expires_at);
create index pos_integrations_restaurant_idx on pos_integrations (restaurant_id);

create table oauth_states (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'SQUARE' check (provider in ('SQUARE')),
  environment text not null check (environment in ('SANDBOX','PRODUCTION')),
  state_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade
);
create index oauth_states_expiry_idx on oauth_states (expires_at);
create index oauth_states_location_idx on oauth_states (location_id);
create index oauth_states_user_idx on oauth_states (user_id);
create index oauth_states_restaurant_idx on oauth_states (restaurant_id);

create table catalog_syncs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  kind text not null check (kind in ('FULL','INCREMENTAL')),
  trigger text not null check (trigger in ('CONNECT','WEBHOOK','SCHEDULE','MANUAL','RECONCILE')),
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCEEDED','FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  since timestamptz,                      -- begin_time for an incremental search
  catalog_high_water timestamptz,         -- newest Square updated_at seen
  objects_upserted int not null default 0,
  objects_deleted int not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  constraint finished_when_done check (status = 'RUNNING' or finished_at is not null)
);
create index catalog_syncs_recent_idx on catalog_syncs (location_id, started_at desc);
create unique index catalog_syncs_one_running on catalog_syncs (location_id) where status = 'RUNNING';
create index catalog_syncs_restaurant_idx on catalog_syncs (restaurant_id);

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  square_id text not null,
  name text not null,
  ordinal int not null default 0,
  is_deleted boolean not null default false,
  square_version bigint not null,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  unique (location_id, square_id),
  unique (id, location_id)
);
create index menu_categories_restaurant_idx on menu_categories (restaurant_id);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  category_id uuid,
  square_id text not null,
  name text not null,
  description text,
  is_deleted boolean not null default false,
  ai_hidden boolean not null default false,         -- platform overlay: never offer by phone
  ai_unavailable_until timestamptz,                 -- platform overlay: 86'd until this time
  overlay_updated_by uuid references users(id) on delete set null,
  square_version bigint not null,
  raw jsonb not null default '{}',
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  foreign key (category_id, location_id) references menu_categories (id, location_id) on delete set null (category_id),
  unique (location_id, square_id),
  unique (id, location_id)
);
create index menu_items_category_idx on menu_items (category_id);
create index menu_items_name_trgm on menu_items using gin (lower(name) gin_trgm_ops);
create index menu_items_restaurant_idx on menu_items (restaurant_id);

create table menu_variations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  item_id uuid not null,
  square_id text not null,
  name text not null,
  pricing_type text not null check (pricing_type in ('FIXED_PRICING','VARIABLE_PRICING')),
  price_minor bigint check (price_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  ordinal int not null default 0,
  sold_out boolean not null default false,          -- from Square location_overrides
  is_deleted boolean not null default false,
  square_version bigint not null,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  foreign key (item_id, location_id) references menu_items (id, location_id) on delete cascade,
  unique (location_id, square_id),
  constraint fixed_has_price check (pricing_type <> 'FIXED_PRICING' or price_minor is not null)
);
create index menu_variations_item_idx on menu_variations (item_id);
create index menu_variations_restaurant_idx on menu_variations (restaurant_id);

create table modifier_lists (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  square_id text not null,
  name text not null,
  selection_type text not null check (selection_type in ('SINGLE','MULTIPLE')),
  min_selected int check (min_selected >= 0),
  max_selected int check (max_selected >= 1),
  is_deleted boolean not null default false,
  square_version bigint not null,
  raw jsonb not null default '{}',
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  unique (location_id, square_id),
  unique (id, location_id),
  constraint min_le_max check (max_selected is null or min_selected is null or max_selected >= min_selected)
);
create index modifier_lists_restaurant_idx on modifier_lists (restaurant_id);

create table modifiers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  modifier_list_id uuid not null,
  square_id text not null,
  name text not null,
  price_minor bigint not null default 0 check (price_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  ordinal int not null default 0,
  on_by_default boolean not null default false,
  sold_out boolean not null default false,
  is_deleted boolean not null default false,
  square_version bigint not null,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  foreign key (modifier_list_id, location_id) references modifier_lists (id, location_id) on delete cascade,
  unique (location_id, square_id),
  unique (id, location_id)
);
create index modifiers_list_idx on modifiers (modifier_list_id);
create index modifiers_restaurant_idx on modifiers (restaurant_id);

-- Nested modifiers (Square API 2026-08-19+: child_modifier_list_ids). Join table, so a composite key.
create table modifier_child_lists (
  restaurant_id uuid not null,
  location_id uuid not null,
  modifier_id uuid not null,
  child_list_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (modifier_id, child_list_id),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  foreign key (modifier_id, location_id) references modifiers (id, location_id) on delete cascade,
  foreign key (child_list_id, location_id) references modifier_lists (id, location_id) on delete cascade
);
create index modifier_child_lists_child_idx on modifier_child_lists (child_list_id);
create index modifier_child_lists_restaurant_idx on modifier_child_lists (restaurant_id);

create table item_modifier_lists (
  restaurant_id uuid not null,
  location_id uuid not null,
  item_id uuid not null,
  modifier_list_id uuid not null,
  enabled boolean not null default true,            -- Square disables rather than removes
  min_selected_override int check (min_selected_override >= 0),
  max_selected_override int check (max_selected_override >= 1),
  ordinal int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, modifier_list_id),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  foreign key (item_id, location_id) references menu_items (id, location_id) on delete cascade,
  foreign key (modifier_list_id, location_id) references modifier_lists (id, location_id) on delete cascade
);
create index item_modifier_lists_list_idx on item_modifier_lists (modifier_list_id);
create index item_modifier_lists_restaurant_idx on item_modifier_lists (restaurant_id);

create table menu_aliases (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  item_id uuid not null,
  variation_id uuid references menu_variations(id) on delete cascade,
  phrase text not null check (length(phrase) between 2 and 80),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  foreign key (item_id, location_id) references menu_items (id, location_id) on delete cascade
);
create unique index menu_aliases_phrase_key on menu_aliases (location_id, lower(phrase));
create index menu_aliases_trgm on menu_aliases using gin (lower(phrase) gin_trgm_ops);
create index menu_aliases_item_idx on menu_aliases (item_id);
create index menu_aliases_variation_idx on menu_aliases (variation_id);
create index menu_aliases_restaurant_idx on menu_aliases (restaurant_id);

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------

create table calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  phone_number_id uuid references phone_numbers(id) on delete set null,
  provider text not null default 'TWILIO' check (provider in ('TWILIO')),
  provider_call_sid text not null unique,
  is_test boolean not null default false,
  from_e164 text,                                    -- caller ID; masked in list views
  to_e164 text not null,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int check (duration_seconds >= 0),
  status text not null default 'IN_PROGRESS'
    check (status in ('RINGING_STAFF','IN_PROGRESS','TRANSFERRING','ENDED')),
  outcome text check (outcome in ('INFO_RESOLVED','ORDER_SUBMITTED','TRANSFERRED','CALLER_HUNG_UP',
                                  'FAILED','CALLBACK_REQUESTED','STAFF_ANSWERED')),
  transfer_status text not null default 'NONE'
    check (transfer_status in ('NONE','ATTEMPTED','CONNECTED','NO_ANSWER','BUSY','FAILED')),
  language text,
  summary text,
  recording_ref text,                                -- storage key; only when recording_enabled
  model text,
  model_session_id text,
  usage jsonb not null default '{}',                 -- token and minute counts, never content
  cost_estimate_minor bigint check (cost_estimate_minor >= 0),
  error_code text,
  purge_after timestamptz,                           -- set at call end from retention_days
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete restrict,
  unique (id, restaurant_id),
  constraint ended_has_outcome check (status <> 'ENDED' or (outcome is not null and ended_at is not null))
);
create index calls_list_idx on calls (location_id, started_at desc);
create index calls_outcome_idx on calls (location_id, outcome, started_at desc);
create index calls_caller_idx on calls (location_id, from_e164);
create index calls_restaurant_idx on calls (restaurant_id, started_at desc);
create index calls_phone_number_idx on calls (phone_number_id);
create index calls_purge_idx on calls (purge_after) where purge_after is not null;

-- Append-only: no updated_at.
create table call_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  call_id uuid not null,
  seq int not null check (seq >= 0),
  event_type text not null check (event_type ~ '^[a-z_]+(\.[a-z_]+)*$'),   -- e.g. tool.search_menu, handoff.triggered
  actor_type text not null check (actor_type in ('SYSTEM','AI','CALLER','STAFF')),
  occurred_at timestamptz not null default now(),
  payload_redacted jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (call_id, restaurant_id) references calls (id, restaurant_id) on delete cascade,
  unique (call_id, seq)
);
create index call_events_restaurant_idx on call_events (restaurant_id, occurred_at);

create table call_transcripts (
  call_id uuid primary key,
  restaurant_id uuid not null,
  segments jsonb not null default '[]',              -- [{speaker, text, at_ms}], redacted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (call_id, restaurant_id) references calls (id, restaurant_id) on delete cascade
);
create index call_transcripts_restaurant_idx on call_transcripts (restaurant_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  call_id uuid,
  is_test boolean not null default false,
  channel text not null default 'PHONE' check (channel in ('PHONE')),
  fulfillment text not null default 'PICKUP' check (fulfillment in ('PICKUP')),
  pickup_at timestamptz,                              -- null = as soon as possible
  customer_name text check (length(customer_name) between 1 and 80),
  customer_phone_e164 text check (customer_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  customer_phone_source text check (customer_phone_source in ('CALLER_ID_CONFIRMED','SPOKEN')),
  special_instructions text check (length(special_instructions) <= 500),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint check (subtotal_minor >= 0),
  tax_minor bigint check (tax_minor >= 0),
  discount_minor bigint check (discount_minor >= 0),
  service_charge_minor bigint check (service_charge_minor >= 0),
  total_minor bigint check (total_minor >= 0),
  totals_version int,                                 -- the order version these totals were calculated for
  totals_calculated_at timestamptz,
  local_status text not null default 'DRAFT' check (local_status in (
    'DRAFT','NEEDS_CLARIFICATION','READY_FOR_CONFIRMATION','CUSTOMER_CONFIRMED',
    'SUBMISSION_PENDING','SUBMISSION_UNKNOWN','SUBMITTED_TO_POS','POS_VISIBILITY_UNVERIFIED',
    'RECEIVED_BY_RESTAURANT','TRANSFERRED_TO_STAFF','ABANDONED','FAILED','CANCELLED')),
  version int not null default 1 check (version >= 1),
  confirmed_version int,
  confirmed_at timestamptz,
  pos_mode text not null check (pos_mode in ('SQUARE','DASHBOARD_TICKET')),
  idempotency_key uuid not null default gen_random_uuid() unique,
  submission_attempts int not null default 0 check (submission_attempts >= 0),
  last_submit_attempt_at timestamptz,
  submitted_at timestamptz,
  received_at timestamptz,
  received_by uuid references users(id) on delete set null,
  square_order_id text unique,
  square_location_id text,
  square_reference_id text,
  square_state text,
  square_version int,
  square_status_snapshot jsonb,
  submission_error_code text,
  submission_error_message_redacted text,
  menu_synced_at_snapshot timestamptz,                -- menu freshness this version was validated against
  cancelled_reason text,
  failed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete restrict,
  foreign key (call_id, restaurant_id) references calls (id, restaurant_id) on delete set null (call_id),
  unique (id, restaurant_id),
  constraint confirmation_not_ahead check (confirmed_version is null or confirmed_version <= version),
  constraint read_back_has_totals check (
    local_status <> 'READY_FOR_CONFIRMATION' or (totals_version = version and total_minor is not null)),
  constraint confirmed_means_this_version check (
    local_status <> 'CUSTOMER_CONFIRMED' or (confirmed_version = version and confirmed_at is not null)),
  -- Only a confirmed, fully priced, current version can be sent anywhere.
  constraint submit_only_confirmed check (
    local_status not in ('SUBMISSION_PENDING','SUBMISSION_UNKNOWN','SUBMITTED_TO_POS',
                         'POS_VISIBILITY_UNVERIFIED','RECEIVED_BY_RESTAURANT')
    or (confirmed_version = version and totals_version = version and total_minor is not null
        and customer_name is not null and customer_phone_e164 is not null)),
  constraint square_id_when_in_square check (
    pos_mode <> 'SQUARE'
    or local_status not in ('SUBMITTED_TO_POS','POS_VISIBILITY_UNVERIFIED','RECEIVED_BY_RESTAURANT')
    or square_order_id is not null),
  constraint test_orders_stay_local check (not is_test or pos_mode = 'DASHBOARD_TICKET')
);
create index orders_list_idx on orders (location_id, created_at desc);
create index orders_status_idx on orders (location_id, local_status, created_at desc);
create index orders_restaurant_idx on orders (restaurant_id, created_at desc);
create index orders_call_idx on orders (call_id);
create unique index orders_one_open_per_call on orders (call_id) where local_status in
  ('DRAFT','NEEDS_CLARIFICATION','READY_FOR_CONFIRMATION','CUSTOMER_CONFIRMED','SUBMISSION_PENDING','SUBMISSION_UNKNOWN');
create index orders_reconcile_idx on orders (last_submit_attempt_at)
  where local_status in ('SUBMISSION_PENDING','SUBMISSION_UNKNOWN');

create table order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_id uuid not null,
  line_no smallint not null check (line_no between 1 and 100),
  variation_id uuid references menu_variations(id) on delete restrict,   -- menu rows are soft-deleted
  square_item_id text not null,
  square_variation_id text not null,
  item_name text not null,                          -- snapshots, for history
  variation_name text not null,
  quantity int not null check (quantity between 1 and 99),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint check (line_total_minor >= 0),
  special_instructions text check (length(special_instructions) <= 200),
  validation_status text not null default 'UNCHECKED'
    check (validation_status in ('UNCHECKED','VALID','INVALID','STALE')),
  validation_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, restaurant_id) references orders (id, restaurant_id) on delete cascade,
  unique (order_id, line_no),
  unique (id, restaurant_id)
);
create index order_items_variation_idx on order_items (variation_id);
create index order_items_restaurant_idx on order_items (restaurant_id);

create table order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_item_id uuid not null,
  parent_id uuid references order_item_modifiers(id) on delete cascade,   -- nested choice
  modifier_id uuid references modifiers(id) on delete restrict,
  square_modifier_id text not null,
  square_modifier_list_id text not null,
  name text not null,
  price_minor bigint not null default 0 check (price_minor >= 0),
  quantity int not null default 1 check (quantity between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_item_id, restaurant_id) references order_items (id, restaurant_id) on delete cascade
);
create index order_item_modifiers_item_idx on order_item_modifiers (order_item_id);
create index order_item_modifiers_parent_idx on order_item_modifiers (parent_id);
create index order_item_modifiers_modifier_idx on order_item_modifiers (modifier_id);
create index order_item_modifiers_restaurant_idx on order_item_modifiers (restaurant_id);

-- Append-only, written by trigger on every status change: no updated_at.
create table order_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_id uuid not null,
  from_status text,
  to_status text not null,
  order_version int not null,
  actor_type text not null check (actor_type in ('SYSTEM','AI','STAFF','SUPPORT','WEBHOOK')),
  actor_user_id uuid references users(id) on delete set null,
  reason text,
  request_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (order_id, restaurant_id) references orders (id, restaurant_id) on delete cascade
);
create index order_events_order_idx on order_events (order_id, occurred_at);
create index order_events_restaurant_idx on order_events (restaurant_id);
create index order_events_actor_idx on order_events (actor_user_id);

create table pos_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_id uuid not null,
  attempt_no smallint not null check (attempt_no >= 1),
  order_version int not null,
  idempotency_key uuid not null,
  request_hash bytea not null,                      -- one key always carries the same body
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('CREATED','TRANSIENT_ERROR','VALIDATION_ERROR','AUTH_ERROR',
                                  'TIMEOUT','RATE_LIMITED','UNKNOWN')),
  http_status smallint,
  provider_request_id text,
  square_order_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, restaurant_id) references orders (id, restaurant_id) on delete cascade,
  unique (order_id, attempt_no)
);
create index pos_submission_attempts_restaurant_idx on pos_submission_attempts (restaurant_id);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  call_id uuid not null,
  order_id uuid,                                    -- the draft in progress, if any
  target_id uuid references transfer_targets(id) on delete set null,
  destination_e164 text not null check (destination_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  reason text not null check (reason in ('CALLER_REQUEST','LOW_CONFIDENCE','POLICY_BOUNDARY',
    'RECOGNITION_FAILURES','SUBMISSION_UNCERTAIN','INTEGRATION_ERROR','ALLERGEN','COMPLAINT','RING_STAFF_FIRST')),
  strategy text not null check (strategy in ('DIRECT','WARM')),
  attempt_no smallint not null default 1 check (attempt_no >= 1),
  provider_child_call_sid text,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  result text check (result in ('CONNECTED','NO_ANSWER','BUSY','FAILED','CANCELED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (call_id, restaurant_id) references calls (id, restaurant_id) on delete cascade,
  foreign key (order_id, restaurant_id) references orders (id, restaurant_id) on delete set null (order_id)
);
create index transfers_call_idx on transfers (call_id);
create index transfers_order_idx on transfers (order_id);
create index transfers_target_idx on transfers (target_id);
create index transfers_restaurant_idx on transfers (restaurant_id, started_at desc);

create table callback_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  call_id uuid,
  customer_name text not null check (length(customer_name) between 1 and 80),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  preferred_window text check (length(preferred_window) <= 100),
  reason text check (length(reason) <= 500),
  status text not null default 'OPEN' check (status in ('OPEN','DONE','CANCELLED')),
  handled_by uuid references users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete restrict,
  foreign key (call_id, restaurant_id) references calls (id, restaurant_id) on delete set null (call_id)
);
create index callback_requests_queue_idx on callback_requests (location_id, status, created_at desc);
create index callback_requests_call_idx on callback_requests (call_id);
create index callback_requests_restaurant_idx on callback_requests (restaurant_id);

-- ---------------------------------------------------------------------------
-- Platform: webhooks, alerts, audit
-- ---------------------------------------------------------------------------

-- Only signature-verified deliveries are stored. Failed checks go to metrics, so a forged
-- request can never claim an event id ahead of the real delivery.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('SQUARE','TWILIO')),
  provider_event_id text not null,
  restaurant_id uuid references restaurants(id) on delete set null,   -- null until resolved
  event_type text not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  attempt_count int not null default 0,
  processed_at timestamptz,
  last_error text,
  payload_redacted jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index webhook_events_queue_idx on webhook_events (processing_status, received_at)
  where processing_status in ('RECEIVED','FAILED');
create index webhook_events_restaurant_idx on webhook_events (restaurant_id);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  kind text not null check (kind in ('ORDER_SUBMISSION_UNKNOWN','ORDER_FAILED','NEW_TICKET',
    'CATALOG_STALE','CATALOG_SYNC_FAILED','POS_AUTH_EXPIRED','POS_REVOKED','TRANSFER_MISSED',
    'CALLBACK_REQUESTED','VOICE_DEGRADED')),
  severity text not null check (severity in ('INFO','WARNING','CRITICAL')),
  order_id uuid,
  call_id uuid,
  message text not null,
  dedupe_key text,
  notified_at timestamptz,
  acknowledged_by uuid references users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, restaurant_id) references locations (id, restaurant_id) on delete cascade,
  foreign key (order_id, restaurant_id) references orders (id, restaurant_id) on delete set null (order_id),
  foreign key (call_id, restaurant_id) references calls (id, restaurant_id) on delete set null (call_id)
);
create unique index alerts_open_dedupe on alerts (location_id, dedupe_key)
  where acknowledged_at is null and dedupe_key is not null;
create index alerts_open_idx on alerts (location_id, created_at desc) where acknowledged_at is null;
create index alerts_order_idx on alerts (order_id);
create index alerts_call_idx on alerts (call_id);
create index alerts_restaurant_idx on alerts (restaurant_id);

-- Append-only and outlives the tenant on purpose: restaurant_id has no foreign key.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid,
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('USER','SUPPORT','SYSTEM')),
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)*$'),       -- e.g. settings.update
  target_type text not null,
  target_id text,
  before_redacted jsonb,
  after_redacted jsonb,
  request_id text,
  ip inet,
  user_agent text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index audit_logs_restaurant_idx on audit_logs (restaurant_id, occurred_at desc);
create index audit_logs_actor_idx on audit_logs (actor_user_id);

-- ---------------------------------------------------------------------------
-- Order integrity triggers (the database enforces the confirmation rules too)
-- ---------------------------------------------------------------------------

create or replace function app.order_transition_allowed(from_s text, to_s text) returns boolean
  language sql immutable as $$
  select from_s = to_s or case from_s
    when 'DRAFT' then to_s in ('NEEDS_CLARIFICATION','READY_FOR_CONFIRMATION','TRANSFERRED_TO_STAFF','ABANDONED','CANCELLED','FAILED')
    when 'NEEDS_CLARIFICATION' then to_s in ('DRAFT','READY_FOR_CONFIRMATION','TRANSFERRED_TO_STAFF','ABANDONED','CANCELLED','FAILED')
    when 'READY_FOR_CONFIRMATION' then to_s in ('CUSTOMER_CONFIRMED','DRAFT','NEEDS_CLARIFICATION','TRANSFERRED_TO_STAFF','ABANDONED','CANCELLED')
    when 'CUSTOMER_CONFIRMED' then to_s in ('SUBMISSION_PENDING','DRAFT','NEEDS_CLARIFICATION','TRANSFERRED_TO_STAFF','ABANDONED','CANCELLED')
    when 'SUBMISSION_PENDING' then to_s in ('SUBMITTED_TO_POS','POS_VISIBILITY_UNVERIFIED','SUBMISSION_UNKNOWN','NEEDS_CLARIFICATION','FAILED')
    when 'SUBMISSION_UNKNOWN' then to_s in ('SUBMISSION_PENDING','SUBMITTED_TO_POS','POS_VISIBILITY_UNVERIFIED','FAILED')
    when 'SUBMITTED_TO_POS' then to_s in ('RECEIVED_BY_RESTAURANT','POS_VISIBILITY_UNVERIFIED','CANCELLED')
    when 'POS_VISIBILITY_UNVERIFIED' then to_s in ('RECEIVED_BY_RESTAURANT','CANCELLED')
    when 'RECEIVED_BY_RESTAURANT' then to_s in ('CANCELLED')
    when 'TRANSFERRED_TO_STAFF' then to_s in ('CANCELLED')
    else false
  end $$;

create or replace function app.guard_order_update() returns trigger language plpgsql as $$
declare
  frozen constant text[] := array['SUBMISSION_PENDING','SUBMISSION_UNKNOWN','SUBMITTED_TO_POS',
    'POS_VISIBILITY_UNVERIFIED','RECEIVED_BY_RESTAURANT','TRANSFERRED_TO_STAFF','ABANDONED','FAILED','CANCELLED'];
begin
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

create trigger orders_guard before update on orders
  for each row execute function app.guard_order_update();

create or replace function app.log_order_transition() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.local_status <> old.local_status then
    insert into order_events (restaurant_id, order_id, from_status, to_status, order_version,
                              actor_type, actor_user_id, reason, request_id)
    values (new.restaurant_id, new.id,
            case when tg_op = 'UPDATE' then old.local_status end, new.local_status, new.version,
            coalesce(nullif(current_setting('app.actor_type', true), ''), 'SYSTEM'),
            app.current_user_id(),
            nullif(current_setting('app.reason', true), ''),
            nullif(current_setting('app.request_id', true), ''));
  end if;
  return null;
end $$;

create trigger orders_log_insert after insert on orders
  for each row execute function app.log_order_transition();
-- Plain AFTER UPDATE (not "update of local_status"): the guard trigger can change the status itself.
create trigger orders_log_status after update on orders
  for each row execute function app.log_order_transition();

-- Any change to lines or modifiers bumps the order version (and so voids confirmation).
create or replace function app.bump_order_version() returns trigger language plpgsql as $$
declare
  target uuid;
begin
  if tg_table_name = 'order_items' then
    target := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  else
    select oi.order_id into target from order_items oi
     where oi.id = case when tg_op = 'DELETE' then old.order_item_id else new.order_item_id end;
  end if;
  if target is not null then
    update orders set version = version + 1 where id = target;
  end if;
  return null;
end $$;

create trigger order_items_bump after insert or delete
  or update of variation_id, quantity, unit_price_minor, special_instructions on order_items
  for each row execute function app.bump_order_version();
create trigger order_item_modifiers_bump after insert or delete
  or update of modifier_id, quantity, price_minor, parent_id on order_item_modifiers
  for each row execute function app.bump_order_version();

-- Every attempt must carry the order's current key and version.
create or replace function app.check_submission_attempt() returns trigger language plpgsql as $$
declare
  o orders%rowtype;
begin
  select * into o from orders where id = new.order_id;
  if new.idempotency_key <> o.idempotency_key or new.order_version <> o.version then
    raise exception 'attempt for order % must use its current idempotency key and version', new.order_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger pos_submission_attempts_check before insert on pos_submission_attempts
  for each row execute function app.check_submission_attempt();

-- ---------------------------------------------------------------------------
-- Views (security_invoker so they obey row level security)
-- ---------------------------------------------------------------------------

create view location_menu_status with (security_invoker = true) as
select l.id as location_id,
       l.restaurant_id,
       ok.finished_at as last_success_at,
       last.status as last_status,
       last.error_code as last_error_code,
       last.started_at as last_started_at,
       (ok.finished_at is null
        or ok.finished_at < now() - make_interval(secs => coalesce(s.menu_stale_max_age_seconds, 3600))) as is_stale
from locations l
left join location_settings s on s.location_id = l.id
left join lateral (select finished_at from catalog_syncs c
                    where c.location_id = l.id and c.status = 'SUCCEEDED'
                    order by finished_at desc limit 1) ok on true
left join lateral (select status, error_code, started_at from catalog_syncs c
                    where c.location_id = l.id
                    order by started_at desc limit 1) last on true;

create view usage_monthly with (security_invoker = true) as
select restaurant_id,
       location_id,
       date_trunc('month', started_at) as month_utc,
       count(*) as calls,
       coalesce(sum(duration_seconds), 0) as call_seconds,
       count(*) filter (where outcome = 'TRANSFERRED') as transferred,
       count(*) filter (where outcome = 'ORDER_SUBMITTED') as orders_submitted,
       coalesce(sum(cost_estimate_minor), 0) as cost_estimate_minor
from calls
where not is_test
group by 1, 2, 3;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
            join information_schema.tables tb using (table_schema, table_name)
           where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger %I before update on %I for each row execute function app.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Roles, grants and row level security
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin;      -- the API's login role is granted membership out of band
  end if;
end $$;

grant usage on schema public, app to app_rw;
grant select, insert, update, delete on all tables in schema public to app_rw;
revoke update, delete on audit_logs, call_events, order_events from app_rw;
grant execute on all functions in schema app to app_rw;

-- On Supabase, keep every table off the auto-generated Data API.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
  end if;
end $$;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;

  -- Plain tenant tables: the row's restaurant must be the transaction's restaurant.
  foreach t in array array[
    'locations','invitations','support_access_grants','location_settings','phone_numbers',
    'transfer_targets','business_hours','special_hours','notices','faqs','pronunciations',
    'pos_integrations','oauth_states','catalog_syncs','menu_categories','menu_items',
    'menu_variations','modifier_lists','modifiers','modifier_child_lists','item_modifier_lists',
    'menu_aliases','calls','call_events','call_transcripts','orders','order_items',
    'order_item_modifiers','order_events','pos_submission_attempts','transfers',
    'callback_requests','alerts']
  loop
    execute format(
      'create policy tenant_isolation on %I to app_rw
         using (app.is_system() or restaurant_id = app.current_restaurant_id())
         with check (app.is_system() or restaurant_id = app.current_restaurant_id())', t);
  end loop;
end $$;

create policy restaurant_access on restaurants to app_rw
  using (app.is_system()
         or id = app.current_restaurant_id()
         or exists (select 1 from memberships m
                     where m.restaurant_id = restaurants.id
                       and m.user_id = app.current_user_id() and m.status = 'ACTIVE'))
  with check (app.is_system() or id = app.current_restaurant_id());

create policy membership_access on memberships to app_rw
  using (app.is_system() or restaurant_id = app.current_restaurant_id() or user_id = app.current_user_id())
  with check (app.is_system() or restaurant_id = app.current_restaurant_id());

create policy user_access on users to app_rw
  using (app.is_system()
         or id = app.current_user_id()
         or exists (select 1 from memberships m
                     where m.user_id = users.id and m.restaurant_id = app.current_restaurant_id()))
  with check (app.is_system() or id = app.current_user_id());

create policy webhook_system_only on webhook_events to app_rw
  using (app.is_system()) with check (app.is_system());

create policy audit_access on audit_logs to app_rw
  using (app.is_system() or restaurant_id = app.current_restaurant_id())
  with check (app.is_system() or restaurant_id = app.current_restaurant_id());

grant select on location_menu_status, usage_monthly to app_rw;
