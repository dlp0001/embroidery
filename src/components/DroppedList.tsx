import { dayAtTime } from '@/lib/format';
import type { BookedChild } from '@/lib/studio';

const WHERE: Record<string, string> = {
  cabinet: 'из кабинета', journal: 'из расписания', bot: 'в боте',
};

/**
 * Кто записывался на занятие, но снялся. Раньше снятая запись просто
 * исчезала, и на вопрос «кто отменил» ответить было нечем — а спрашивают
 * об этом через неделю, когда никто уже не помнит.
 */
export default function DroppedList({ dropped }: { dropped: BookedChild[] }) {
  if (dropped.length === 0) return null;

  return (
    <div className="sub" style={{ marginTop: 6, color: 'rgba(26,26,46,0.4)' }}>
      {dropped.map((b) => (
        <div key={b.participant_id}>
          {b.who} — снял
          {b.changed_by ? `(а) ${b.changed_by}` : 'и неизвестно кто'}
          {b.changed_via ? ` ${WHERE[b.changed_via] ?? ''}` : ''}
          {', '}{dayAtTime(b.changed_at)}
        </div>
      ))}
    </div>
  );
}
