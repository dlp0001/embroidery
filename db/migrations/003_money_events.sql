-- Реестр финансовых событий: кто, что, когда и на какую сумму.
-- Ссылки на начисления, абонементы и платежи держим обычными uuid,
-- без внешних ключей: запись в реестре должна пережить удаление того,
-- о чём она рассказывает.
create table money_events (
  id             uuid primary key default gen_random_uuid(),
  at             timestamptz not null default now(),
  kind           text not null,
  actor_id       uuid references users(id) on delete set null,
  owner_id       uuid references users(id) on delete set null,
  participant_id uuid references participants(id) on delete set null,
  session_id     uuid references studio_sessions(id) on delete set null,
  charge_id      uuid,
  pass_id        uuid,
  payment_id     uuid,
  amount         numeric(10,2),
  currency       text,
  note           text,
  details        jsonb
);

create index money_events_at_idx on money_events (at desc);
create index money_events_owner_idx on money_events (owner_id, at desc);
create index money_events_session_idx on money_events (session_id);
