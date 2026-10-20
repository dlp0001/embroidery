-- Перевод того, что напечатано на иврите.
--
-- Чек читается один раз и дорого — там картинка. Перевод названий это
-- просто текст, он стоит копейки и делается отдельно, поэтому лежит
-- отдельными полями: перечитывать снимок ради него незачем.

alter table expenses add column if not exists trade_name_en text;
alter table expense_items add column if not exists name_ru text;
