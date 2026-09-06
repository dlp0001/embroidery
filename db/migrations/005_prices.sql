-- Цена занятия и виды абонементов. Абонемент дешевле разовых занятий,
-- поэтому его цена задаётся отдельно, а не считается умножением.
insert into settings (key, value) values
  ('studio_lesson_price', '100'),
  ('studio_currency', 'ILS'),
  ('pass_types', '[{"lessons":4,"price":360,"months":3},{"lessons":8,"price":680,"months":3}]')
on conflict (key) do update set value = excluded.value;
