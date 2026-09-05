import { hhmm, plural } from '@/lib/format';
import type { SlotRow } from '@/lib/studio';
import { toggleBooking } from '@/app/account/actions';

/**
 * Занятия за день. Кнопки «записать» нет: под каждым занятием имена тех,
 * кому оно подходит, и галочка у каждого.
 */
export default function SlotList({ rows }: { rows: SlotRow[] }) {
  const bySession = new Map<string, SlotRow[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);

  return (
    <>
      {[...bySession.values()].map((people) => {
        const head = people[0];
        const free = head.capacity == null ? null : head.capacity - head.taken;
        return (
          <div className="card" key={head.session_id}>
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
              <div className="when" style={{ marginBottom: 0 }}>
                {hhmm(head.starts_at)} · {head.group_title}
              </div>
              <div className="tag tag-ok">
                {head.audience === 'adults' ? 'взрослое' : 'детское'}
              </div>
            </div>

            {people.map((p) => (
              <form action={toggleBooking} key={p.participant_id}>
                <input type="hidden" name="sessionId" value={p.session_id} />
                <input type="hidden" name="participantId" value={p.participant_id} />
                <input type="hidden" name="booked" value={p.booked ? '0' : '1'} />
                <button
                  type="submit"
                  className="pick"
                  aria-pressed={p.booked}
                  aria-label={`${p.who}: ${p.booked ? 'отменить запись' : 'записать'}`}
                >
                  <span className={p.booked ? 'box box-on' : 'box'}>
                    {p.booked && (
                      <svg viewBox="0 0 24 24">
                        <path d="M4 12.5 L9.5 18 L20 6" />
                      </svg>
                    )}
                  </span>
                  <span className={p.booked ? 'pick-name pick-on' : 'pick-name'}>{p.who}</span>
                  {p.preferred && !p.booked && <span className="pick-hint">обычно ходит</span>}
                </button>
              </form>
            ))}

            {free !== null && (
              <div className="sub" style={{ marginTop: 10 }}>
                {free > 0
                  ? `Свободно ${free} ${plural(free, 'место', 'места', 'мест')}`
                  : 'Мест не осталось'}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
