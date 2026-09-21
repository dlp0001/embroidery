import { dayMonth, hhmm, money, plural } from '@/lib/format';
import type { SlotRow } from '@/lib/studio';
import { toggleBooking } from '@/app/account/actions';

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** «22.09»: в смене дней много, и кнопка должна быть короткой. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/** День недели над числом: в смене подряд десять дней, и они путаются. */
function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Запись на лагерь и мастер-класс. В отличие от обычных занятий, смена
 * идёт подряд несколько дней, и выбирать их удобнее не по одному дню в
 * календаре, а сразу списком: строка на человека, кнопка на день.
 */
export default function EventSignup({ rows }: { rows: SlotRow[] }) {
  if (rows.length === 0) return null;

  const byGroup = new Map<string, SlotRow[]>();
  for (const r of rows) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r]);

  return (
    <>
      {[...byGroup.values()].map((slots) => {
        const head = slots[0];
        const days = [...new Set(slots.map((s) => s.held_on))].sort();
        const people = [...new Map(slots.map((s) => [s.participant_id, s.who])).entries()];
        const mine = slots.filter((s) => s.booked).length;

        return (
          <div className="card" key={head.group_id}>
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
              <div className="when" style={{ marginBottom: 0 }}>
                {dayMonth(days[0])} — {dayMonth(days[days.length - 1])} · {hhmm(head.starts_at)}
              </div>
              <div className="tag tag-ok">{head.kind === 'camp' ? 'лагерь' : 'мастер-класс'}</div>
            </div>
            <div className="what">{head.group_title}</div>
            <div className="sub" style={{ marginBottom: 12 }}>
              День стоит {money(Number(head.price), 'ILS')}. Выгоднее взять пакет
              в «Оплате».{' '}
              {mine > 0
                ? `Записаны на ${mine} ${plural(mine, 'день', 'дня', 'дней')}.`
                : 'Отметьте дни, в которые придёте.'}
            </div>

            {people.map(([participantId, who]) => (
              <div key={participantId} style={{ marginBottom: 12 }}>
                <div className="lbl" style={{ margin: '0 0 6px' }}>{who}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {days.map((day) => {
                    const slot = slots.find(
                      (s) => s.held_on === day && s.participant_id === participantId,
                    );
                    if (!slot) return null;
                    return (
                      <form action={toggleBooking} key={day}>
                        <input type="hidden" name="sessionId" value={slot.session_id} />
                        <input type="hidden" name="participantId" value={participantId} />
                        <input type="hidden" name="booked" value={slot.booked ? '0' : '1'} />
                        <button
                          type="submit"
                          className={slot.booked ? 'chip-on' : 'chip'}
                          aria-pressed={slot.booked}
                          aria-label={`${who}, ${weekday(day)} ${dayMonth(day)}: ${
                            slot.booked ? 'отменить запись' : 'записать'}`}
                          style={{ lineHeight: 1.3, textAlign: 'center' }}
                        >
                          <span style={{ display: 'block', fontSize: 10, letterSpacing: '0.16em',
                                         textTransform: 'uppercase', opacity: 0.7 }}>
                            {weekday(day)}
                          </span>
                          {shortDay(day)}
                        </button>
                      </form>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
