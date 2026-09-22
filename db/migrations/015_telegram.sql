-- Телеграм-бот: привязка чата и след отправленного.
--
-- Ник (users.telegram) и chat_id — разные вещи, и живут они рядом. Ник
-- нужен Варе, чтобы написать человеку руками из админки. Боту он
-- бесполезен: по нику писать нельзя, адресом является только chat_id, и
-- он появляется лишь после того, как человек сам нажал Start.

alter table users add column if not exists tg_chat_id bigint;

create unique index if not exists users_tg_chat_idx
  on users (tg_chat_id) where tg_chat_id is not null;

-- Привязка. Одноразовый токен уезжает в ссылку t.me/<bot>?start=<token>,
-- в базе лежит его хеш — как у login_codes и по тем же причинам: из
-- дампа базы нельзя привязаться к чужой семье.
create table if not exists tg_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tg_links_user_idx on tg_links (user_id, created_at desc);

-- След отправленного: крон может сработать дважды, деплой — перезапустить
-- рассылку. Без этого родитель получит один и тот же вопрос два раза.
-- Нужен начиная с вечерних вопросов, заводим сразу, чтобы не городить
-- вторую миграцию ради одной таблицы.
create table if not exists tg_log (
  campaign  text not null,
  chat_id   bigint not null,
  sent_at   timestamptz not null default now(),
  primary key (campaign, chat_id)
);
