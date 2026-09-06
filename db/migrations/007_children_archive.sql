-- Ребёнка, который уже ходил на занятия, удалять нельзя: он есть в
-- журналах и в деньгах. Но и висеть в списках он не должен, если больше
-- не ходит. Поэтому его можно скрыть, а не стирать.
alter table children add column if not exists archived_at timestamptz;

create index if not exists children_active_idx on children (id) where archived_at is null;
