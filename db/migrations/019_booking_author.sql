-- Кто менял запись и откуда.
--
-- Время изменения уже пишется (016), но на вопрос «кто снял запись»
-- ответить было нечем: родитель из кабинета, Варя из расписания и бот
-- вечером меняют одну и ту же строку и следа не оставляют. Теперь строка
-- помнит автора и место: этого хватает, чтобы разобраться, не спрашивая.
alter table bookings
  add column if not exists changed_by uuid references users(id) on delete set null,
  add column if not exists changed_via text;

alter table bookings drop constraint if exists bookings_changed_via_check;
alter table bookings add constraint bookings_changed_via_check
  check (changed_via is null or changed_via in ('cabinet', 'journal', 'bot'));
