-- Обычные занятия отменяются ради лагеря. Чтобы их можно было вернуть,
-- когда смена сдвинулась или ушла в архив, помним, из-за кого отменили.
alter table studio_sessions
  add column if not exists cancelled_for uuid references studio_groups(id) on delete set null;
