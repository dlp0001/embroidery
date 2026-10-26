// Одноразово: блоки сводки по занятиям дня. Только чтение.
import { query } from '@/lib/db';
import { teacherSessionView } from '@/lib/telegram';

async function main(): Promise<void> {
  const rows = await query<{ id: string; at: string }>(
    `select s.id, coalesce(s.starts_at, g.starts_at)::text as at
       from studio_sessions s join studio_groups g on g.id = s.group_id
      where s.held_on = $1::date and s.status <> 'cancelled' and g.kind = 'lesson'
      order by coalesce(s.starts_at, g.starts_at)`, [process.argv[2] ?? '']);
  for (const r of rows) {
    const view = await teacherSessionView(r.id, 'Варя');
    console.log(`--- ${r.at} ---`);
    console.log((view?.text ?? 'нет').split('\n').slice(2).join('\n'));
    console.log();
  }
  process.exit(0);
}

void main();
