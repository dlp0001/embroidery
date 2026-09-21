-- Занятия бывают не только еженедельные и не только по одной цене:
-- лагерь идёт подряд несколько дней и стоит своё, мастер-класс разовый.
-- Поэтому цена и набор пакетов переезжают из настроек студии в группу.
alter table studio_groups
  add column if not exists kind text not null default 'lesson',
  add column if not exists price numeric(10,2),
  add column if not exists pass_offers jsonb,
  add column if not exists starts_on date,
  add column if not exists ends_on date;

alter table studio_groups drop constraint if exists studio_groups_kind_check;
alter table studio_groups add constraint studio_groups_kind_check
  check (kind in ('lesson', 'camp', 'event'));

-- У лагеря и мастер-класса дня недели нет: их дни заводят периодом.
alter table studio_groups alter column weekday drop not null;

-- Пакет теперь может принадлежать своей группе: купленные в лагерь дни
-- тратятся только в нём и вместе с ним заканчиваются. Обычный абонемент
-- остаётся ничьим и работает на обычных занятиях.
alter table passes
  add column if not exists group_id uuid references studio_groups(id) on delete restrict;

create index if not exists passes_group_idx on passes (group_id) where group_id is not null;
