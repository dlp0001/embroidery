-- Переписка через бота: чьё сообщение переслали и куда.
--
-- Родитель пишет боту, бот передаёт сообщение в студию. Чтобы ответ
-- вернулся тому, кто спрашивал, нужно помнить, какой пересланной
-- карточке какой родитель соответствует: отвечают на неё же, ответом
-- в телеграме.
create table if not exists tg_relay (
  chat_id    bigint not null,
  message_id bigint not null,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create index if not exists tg_relay_old_idx on tg_relay (created_at);
