-- Начатая оплата курса: человек заполнил форму и ушёл на страницу кассы.
-- Касса возвращает нам этот id (PayPlus — в more_info, Polar и ЮKassa — в
-- metadata), и по нему вебхук понимает, чей это платёж и сколько должно
-- было прийти. Брошенные оплаты остаются здесь же: видно, кто дошёл до
-- кассы и не заплатил.
create table course_checkouts (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references courses(id) on delete cascade,
  email         citext not null,
  name          text,
  provider      text not null check (provider in ('payplus', 'polar', 'yookassa')),
  -- Идентификатор у кассы: страница PayPlus, checkout Polar, платёж ЮKassa.
  provider_ref  text,
  amount        numeric not null,
  currency      text not null,
  -- Согласия на обработку данных и рассылку: просит ЮKassa по 152-ФЗ.
  consents      jsonb,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
create index course_checkouts_ref_idx on course_checkouts(provider, provider_ref);

alter table course_orders
  add column checkout_id  uuid references course_checkouts(id),
  -- Квитанция iCount. Только для PayPlus: за Polar квитанцию шлёт Polar,
  -- за ЮKassa — сама ЮKassa чеком по 54-ФЗ.
  add column receipt_url  text,
  add column receipt_error text;
