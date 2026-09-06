-- Абонемент на 4 занятия живёт месяц, на 8 — два. Три месяца были
-- временной догадкой, пока Варя не назвала настоящие сроки.
update settings
   set value = '[{"lessons":4,"price":360,"months":1},{"lessons":8,"price":680,"months":2}]'
 where key = 'pass_types';

insert into settings (key, value)
select 'pass_types', '[{"lessons":4,"price":360,"months":1},{"lessons":8,"price":680,"months":2}]'
 where not exists (select 1 from settings where key = 'pass_types');
