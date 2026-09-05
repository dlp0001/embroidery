-- Тип занятия: детское или взрослое. Подростков сводим к детям,
-- отдельный тип для них пока не нужен.
update studio_groups set audience = 'kids' where audience = 'teens';
alter table studio_groups drop constraint if exists studio_groups_audience_check;
alter table studio_groups add constraint studio_groups_audience_check
  check (audience in ('kids', 'adults'));

-- Приоритетные дни: в какие дни недели человек рассчитывает ходить.
-- Записью не является, только помогает подсветить нужные занятия.
create table preferred_days (
  participant_id uuid not null references participants(id) on delete cascade,
  weekday        int not null check (weekday between 1 and 7),
  primary key (participant_id, weekday)
);
