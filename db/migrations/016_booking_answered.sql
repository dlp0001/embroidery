-- Когда запись поменялась в последний раз.
--
-- Без этого вечерний вопрос слеп. setBooking при повторной записи
-- обновляет статус существующей строки, а created_at остаётся от первой
-- вставки, и «ответил сегодня вечером» неотличимо от «записался неделю
-- назад». Рассылке это нужно, чтобы не спрашивать дважды и чтобы вообще
-- понимать, отвечает ли кто-нибудь.

alter table bookings add column if not exists updated_at timestamptz not null default now();

create index if not exists bookings_updated_idx on bookings (updated_at desc);
