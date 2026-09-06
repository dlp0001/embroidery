-- Постоянный состав групп больше не решает, кто в журнале: состав
-- собирается по типу занятия, а дни и записи только делят список на
-- «ждём» и «остальных». Чтобы никто не пропал, переносим нынешнее
-- членство в приоритетные дни: день группы становится днём человека.
insert into preferred_days (participant_id, weekday)
select distinct m.participant_id, g.weekday
  from studio_members m
  join studio_groups g on g.id = m.group_id
 where m.left_at is null
on conflict do nothing;

comment on table studio_members is
  'Историческая таблица: состав журнала больше от неё не зависит, см. preferred_days';
