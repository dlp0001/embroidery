-- Взрослый не обязательно ходит на занятия сам: чаще он просто родитель.
-- Пока он не сказал обратного, в списках взрослых групп его быть не должно.
alter table users add column if not exists attends boolean not null default false;
