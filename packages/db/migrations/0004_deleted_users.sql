-- Accounts people deleted. A sign-in token stays valid until it expires (up to an hour) and the person may
-- still be signed in on another device, so the API checks here instead of creating the user again from
-- that token: deleting your account is final. Only the id is kept, no name or email.

create table deleted_users (
  id uuid primary key,
  deleted_at timestamptz not null default now()
);

alter table deleted_users enable row level security;
alter table deleted_users force row level security;
create policy deleted_users_system_only on deleted_users to app_rw
  using (app.is_system()) with check (app.is_system());
grant select, insert on deleted_users to app_rw;
