-- Письма всем сразу: анонс смены, перенос занятия, напоминание.
--
-- Нужны две вещи. Первая — отказ: человек должен уметь выйти из рассылки
-- одной ссылкой, не заходя в кабинет. Вторая — след: какое письмо кому
-- уже ушло, чтобы повторный запуск скрипта не прислал то же самое дважды.
-- Письма о занятиях и деньгах конкретного человека отказом не отменяются:
-- код входа и квитанция приходят всегда.

alter table users add column if not exists mail_optout_at timestamptz;

create table if not exists mail_log (
  campaign    text not null,
  email       citext not null,
  user_id     uuid references users(id) on delete set null,
  provider_id text,
  sent_at     timestamptz not null default now(),
  primary key (campaign, email)
);

create index if not exists mail_log_campaign_idx on mail_log (campaign, sent_at);
