create extension if not exists citext;
create extension if not exists pgcrypto;

-- ── Люди ──────────────────────────────────────────────────
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       citext unique not null,
  name        text,
  phone       text,
  telegram    text,
  locale      text not null default 'ru',
  created_at  timestamptz not null default now()
);

create table user_roles (
  user_id  uuid not null references users(id) on delete cascade,
  role     text not null check (role in ('parent','student','teacher','admin','superadmin')),
  primary key (user_id, role)
);

create table children (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table guardians (
  child_id  uuid not null references children(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  primary key (child_id, user_id)
);

-- Участник занятия: либо ребёнок, либо взрослый.
create table participants (
  id        uuid primary key default gen_random_uuid(),
  child_id  uuid references children(id) on delete cascade,
  user_id   uuid references users(id) on delete cascade,
  constraint participant_is_one_person check (num_nonnulls(child_id, user_id) = 1)
);
create unique index participants_child_uniq on participants(child_id) where child_id is not null;
create unique index participants_user_uniq  on participants(user_id)  where user_id  is not null;

-- ── Вход ──────────────────────────────────────────────────
create table login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index login_codes_email_idx on login_codes(email, created_at desc);

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz
);
create index sessions_user_idx on sessions(user_id);

create table consents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('data','marketing')),
  version    text,
  granted_at timestamptz not null default now(),
  ip         text,
  user_agent text
);

-- ── Курсы ─────────────────────────────────────────────────
create table courses (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,
  title  text not null,
  status text not null default 'draft'
);

create table lessons (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references courses(id) on delete cascade,
  position        int not null,
  slug            text not null,
  title           text not null,
  bunny_video_id  text,
  unique (course_id, slug)
);

create table enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  course_id   uuid not null references courses(id) on delete cascade,
  source      text not null default 'purchase',
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  unique (user_id, course_id)
);

-- ── Студия ────────────────────────────────────────────────
create table studio_groups (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  teacher_id  uuid references users(id),
  weekday     int not null check (weekday between 1 and 7),
  starts_at   time not null,
  duration_min int not null default 90,
  room        text,
  audience    text not null default 'kids' check (audience in ('kids','teens','adults')),
  age_hint    text,
  capacity    int,
  active      boolean not null default true
);

create table studio_members (
  group_id       uuid not null references studio_groups(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  joined_at      date not null default current_date,
  left_at        date,
  primary key (group_id, participant_id)
);

create table studio_sessions (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references studio_groups(id) on delete cascade,
  held_on   date not null,
  status    text not null default 'planned' check (status in ('planned','done','cancelled')),
  closed_at timestamptz,
  unique (group_id, held_on)
);

create table bookings (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references studio_sessions(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  status         text not null default 'booked' check (status in ('booked','cancelled')),
  created_at     timestamptz not null default now(),
  unique (session_id, participant_id)
);

create table attendance (
  session_id     uuid not null references studio_sessions(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  status         text not null check (status in ('present','absent','sick','trial')),
  marked_by      uuid references users(id),
  marked_at      timestamptz not null default now(),
  primary key (session_id, participant_id)
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  provider_id   text,
  user_id       uuid references users(id),
  amount        numeric(10,2) not null,
  currency      text not null default 'ILS',
  status        text not null default 'pending' check (status in ('pending','paid','refunded','failed')),
  purpose       text,
  invoice_url   text,
  raw           jsonb,
  created_at    timestamptz not null default now(),
  unique (provider, provider_id)
);

-- Абонемент: пакет занятий, принадлежит взрослому, тратится на всю семью.
create table passes (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references users(id) on delete cascade,
  lessons_total  int not null check (lessons_total > 0),
  valid_from     date not null default current_date,
  valid_to       date,
  payment_id     uuid references payments(id),
  created_at     timestamptz not null default now()
);
create index passes_owner_idx on passes(owner_id);

-- Начисление за одно посещение: либо покрыто абонементом, либо долг.
create table charges (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  session_id     uuid not null references studio_sessions(id) on delete cascade,
  owner_id       uuid not null references users(id) on delete cascade,
  amount         numeric(10,2) not null,
  currency       text not null default 'ILS',
  pass_id        uuid references passes(id) on delete set null,
  payment_id     uuid references payments(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (participant_id, session_id)
);
create index charges_owner_idx on charges(owner_id);
create index charges_unpaid_idx on charges(owner_id) where pass_id is null and payment_id is null;

create table settings (
  key   text primary key,
  value text not null
);
