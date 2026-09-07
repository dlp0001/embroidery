-- Ребёнка приводят на занятие раньше, чем регистрируется его родитель.
-- Занятие при этом уже случилось, и деньги за него могут быть отданы
-- наличными. Поэтому начисление умеет жить без плательщика: владелец
-- проставится, когда ребёнка привяжут к взрослому.
alter table charges alter column owner_id drop not null;

create index if not exists charges_ownerless_idx on charges (participant_id)
  where owner_id is null;
