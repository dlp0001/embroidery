-- Расходы студии: снимок чека, разобранные поля и своя структура затрат.
--
-- Зачем своя, когда есть iCount: там видов расхода три, и заведены они
-- под бухгалтерию, а не под вопрос «сколько в этом месяце ушло на
-- материалы для лагеря». Наши группы отвечают на него, а в iCount
-- каждая переводится в его вид расхода — одним полем.

create table if not exists expense_kinds (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  /* Чем это становится в iCount: expense_type_id из их справочника. */
  icount_type   int not null,
  sort          int not null default 0,
  active        boolean not null default true
);

-- Начальный набор: то, на что студия тратит чаще всего. Переименовать и
-- дополнить можно на странице «Расходы» — здесь только первые кнопки.
insert into expense_kinds (title, icount_type, sort) values
  ('Материалы для занятий', 4, 1),
  ('Канцелярия', 2, 2),
  ('Лагерь: еда и расходники', 4, 3),
  ('Оборудование и мебель', 4, 4),
  ('Реклама и печать', 2, 5),
  ('Прочее', 2, 9)
on conflict do nothing;

create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  /* Сам снимок. Телеграм отдаёт уменьшенный вариант, его и храним:
     чек на тысяче точек читается, а место в базе не кончится. */
  photo         bytea,
  photo_type    text,
  /* Что разобрала модель. Поля отдельно — по ним считаем и ищем. */
  supplier      text,
  supplier_vat  text,
  doc_type      text,
  doc_number    text,
  spent_on      date,
  amount        numeric(10,2),
  vat           numeric(10,2),
  currency      text not null default 'ILS',
  kind_id       uuid references expense_kinds(id) on delete set null,
  /* new — разобран и ждёт подтверждения, done — проведён в iCount,
     dropped — отклонён человеком. */
  status        text not null default 'new'
                check (status in ('new', 'done', 'dropped')),
  /* Номер расхода в iCount и id поставщика там же. */
  icount_id     text,
  icount_sup    text,
  /* Ответ модели целиком: по нему разбираются, если поля разъехались. */
  raw           jsonb,
  /* Кто прислал и в какой чат отвечать. */
  user_id       uuid references users(id) on delete set null,
  chat_id       bigint,
  message_id    bigint,
  created_at    timestamptz not null default now(),
  done_at       timestamptz
);

create index if not exists expenses_month_idx on expenses (spent_on desc);
create index if not exists expenses_status_idx on expenses (status) where status = 'new';
