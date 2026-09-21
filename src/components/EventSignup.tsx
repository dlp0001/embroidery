import { dayMonth, hhmm, money, plural } from '@/lib/format';
import type { SlotRow } from '@/lib/studio';
import { toggleBooking } from '@/app/account/actions';

/** Неделя начинается с воскресенья: так живёт Израиль. */
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function utc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function shift(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

/**
 * Все дни целыми неделями: от воскресенья перед сменой до субботы после
 * неё. Так видно не только рабочие дни, но и дырки между ними — смена
 * из десяти дней подряд и смена «через выходной» перестают выглядеть
 * одинаково.
 */
function calendarDays(days: string[]): string[] {
  const first = utc(days[0]);
  const last = utc(days[days.length - 1]);
  const to = shift(last, 6 - last.getUTCDay());
  const out: string[] = [];
  for (let d = shift(first, -first.getUTCDay()); d <= to; d = shift(d, 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Первое число месяца подписываем целиком: иначе сентябрь и октябрь сливаются. */
function label(day: string): string {
  const [, m, d] = day.split('-');
  return d === '01' ? `1.${m}` : String(Number(d));
}

const cell: React.CSSProperties = {
  padding: '9px 0', width: '100%', textAlign: 'center',
  letterSpacing: 0, fontSize: 13,
};

/**
 * Запись на лагерь и мастер-класс. В отличие от обычных занятий, смена
 * идёт подряд несколько дней, и выбирать их удобнее не по одному дню в
 * календаре, а сразу сеткой: строка на человека, клетка на день.
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
        const grid = calendarDays(days);

        return (
          <div className="card" key={head.group_id}>
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
              <div className="when" style={{ marginBottom: 0 }}>
                {dayMonth(days[0])} — {dayMonth(days[days.length - 1])} · {hhmm(head.starts_at)}
              </div>
              <div className="tag tag-ok">{head.kind === 'camp' ? 'лагерь' : 'мастер-класс'}</div>
            </div>
            <div className="what">{head.group_title}</div>
            <div className="sub" style={{ marginBottom: 14 }}>
              День стоит {money(Number(head.price), 'ILS')}. Выгоднее взять пакет
              в «Оплате».{' '}
              {mine > 0
                ? `Записаны на ${mine} ${plural(mine, 'день', 'дня', 'дней')}.`
                : 'Отметьте дни, в которые придёте.'}
            </div>

            {people.map(([participantId, who]) => (
              <div key={participantId} style={{ marginBottom: 16 }}>
                <div className="lbl" style={{ margin: '0 0 6px' }}>{who}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                  {WD.map((w) => (
                    <div key={w} className="hint"
                         style={{ textAlign: 'center', fontSize: 10, letterSpacing: '0.1em',
                                  textTransform: 'uppercase', marginBottom: 2 }}>
                      {w}
                    </div>
                  ))}

                  {grid.map((day) => {
                    const slot = slots.find(
                      (s) => s.held_on === day && s.participant_id === participantId,
                    );
                    // В этот день смены нет: клетка нерабочая, с крестиком.
                    if (!slot) {
                      return (
                        <div key={day}
                             style={{ ...cell, color: 'var(--warm-gray)', opacity: 0.45 }}
                             title={`${dayMonth(day)} — занятий нет`}>
                          ×
                        </div>
                      );
                    }
                    return (
                      <form action={toggleBooking} key={day}>
                        <input type="hidden" name="sessionId" value={slot.session_id} />
                        <input type="hidden" name="participantId" value={participantId} />
                        <input type="hidden" name="booked" value={slot.booked ? '0' : '1'} />
                        <button
                          type="submit"
                          className={slot.booked ? 'chip-on' : 'chip'}
                          aria-pressed={slot.booked}
                          aria-label={`${who}, ${dayMonth(day)}: ${
                            slot.booked ? 'отменить запись' : 'записать'}`}
                          style={cell}
                        >
                          {label(day)}
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
