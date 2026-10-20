-- Строки чека.
--
-- Расход в бухгалтерии — это одна сумма, и iCount строк не принимает.
-- Но вопросы студии живут именно в строках: сколько за год ушло на
-- краски, подорожал ли холст, и сколько из похода в магазин было едой
-- для лагеря, а сколько материалами. Поэтому разбираем чек целиком и
-- держим строки у себя — чтобы потом пересобрать его под любые статьи,
-- какие заведём.
--
-- Это показания машины, а не подтверждённые данные: человек глазами
-- сверяет шапку и итог, а тридцать две строки — нет. Поэтому догадка о
-- группе лежит отдельным полем и так и называется.

create table if not exists expense_items (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references expenses(id) on delete cascade,
  /* Порядок строк на бумаге: по нему чек читается как чек. */
  line_no     int not null,
  /* Артикул или штрихкод, как напечатан. */
  sku         text,
  name        text not null,
  qty         numeric(10,3),
  /* Цена за штуку, если видна отдельно от суммы строки. */
  price       numeric(10,2),
  sum         numeric(10,2),
  /* Чем это кажется модели: materials, stationery, equipment, food, other. */
  kind_guess  text
);

create index if not exists expense_items_of_idx on expense_items (expense_id, line_no);
create index if not exists expense_items_guess_idx on expense_items (kind_guess);

-- Наши статьи затрат получают постоянное имя: модель говорит на нём, а
-- названия статей люди меняют как хотят, и привязывать догадку к ним
-- значило бы ломать разбор каждым переименованием.
alter table expense_kinds add column if not exists slug text;

update expense_kinds set slug = 'materials'  where title = 'Материалы для занятий' and slug is null;
update expense_kinds set slug = 'stationery' where title = 'Канцелярия' and slug is null;
update expense_kinds set slug = 'food'       where title = 'Лагерь: еда и расходники' and slug is null;
update expense_kinds set slug = 'equipment'  where title = 'Оборудование и мебель' and slug is null;
update expense_kinds set slug = 'other'      where title = 'Прочее' and slug is null;
