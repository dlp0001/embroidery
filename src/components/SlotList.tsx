import { hhmm, money, packageFrom, plural, todayISO } from '@/lib/format';
import type { SlotRow } from '@/lib/studio';
import { toggleBooking } from '@/app/account/actions';

/**
 * Ширина кнопки задана числом: «Записать» и «Отменить» набираются
 * по-разному, и без этого кнопка дёргалась бы при каждом нажатии.
 */
const signUp: React.CSSProperties = { width: 116, textAlign: 'center' };

/** Сколько мест осталось. Своей записи «мест нет» не пишем: место уже занято вами. */
function seats(free: number | null, booked: boolean): string | null {
  if (free === null) return null;
  if (free > 0) return `мест: ${free}`;
  return booked ? null : 'мест нет';
}

/**
 * Занятия за день. Под каждым занятием имена тех, кому оно подходит, и
 * кнопка записи у каждого имени.
 */
export default function SlotList({ rows }: { rows: SlotRow[] }) {
  const bySession = new Map<string, SlotRow[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);
  // «Календарь» пускает и в прошлые дни. Записаться туда нельзя: занятие
  // прошло, и обещание прийти на него ничего не значит.
  const today = todayISO();

  return (
    <>
      {[...bySession.values()].map((people) => {
        const head = people[0];
        const free = head.capacity == null ? null : Math.max(head.capacity - head.taken, 0);
        // Места пишем в строке со временем: там на них смотрят, решая
        // «идём ли», — а не внизу карточки, после всех имён.
        const left = seats(free, people.some((p) => p.booked));
        return (
          <div className="card" key={head.session_id}>
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
              <div className="when" style={{ marginBottom: 0 }}>
                {hhmm(head.starts_at)}
                {/* Перенос показываем сразу за временем: родитель смотрит
                    на эту строку, чтобы понять, когда приходить. */}
                {head.moved && <span style={{ color: 'var(--rose)' }}> · перенесено</span>}
                {' · '}{head.group_title}{left ? ` · ${left}` : ''}
              </div>
              <div className="tag tag-ok">
                {head.kind === 'camp' ? 'лагерь'
                  : head.kind === 'event' ? 'мастер-класс'
                  : head.audience === 'adults' ? 'взрослое' : 'детское'}
              </div>
            </div>

            {head.kind !== 'lesson' && (
              <div className="sub" style={{ marginBottom: 8 }}>
                День стоит {money(Number(head.price), 'ILS')}.{' '}
                {(() => {
                  const from = packageFrom(Number(head.price), head.pass_offers);
                  return from === null
                    ? 'Платится за те дни, в которые ребёнок пришёл.'
                    : `Если планируете ${from} ${plural(from, 'день', 'дня', 'дней')} и больше,
                       выгоднее взять пакет в «Оплате».`;
                })()}
              </div>
            )}

            {people.map((p) => {
              // Занять последнее место может только тот, кто ещё не записан:
              // себя отменить можно всегда.
              const past = head.held_on < today;
              const full = !past && free === 0 && !p.booked;
              return (
                <div className="row" key={p.participant_id}
                     style={{ minHeight: 52, padding: '8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10,
                                flexWrap: 'wrap', minWidth: 0 }}>
                    <span className={p.booked ? 'pick-name pick-on' : 'pick-name'}>{p.who}</span>
                    {/* Состояние стоит у имени, а не на кнопке: кнопка говорит,
                        что случится от нажатия, и «придёт» на ней читалось бы
                        как обещание записать, а не как уже сделанная запись.
                        Слово то же, что в журнале у Вари. */}
                    {p.booked && <span className="signed">придёт</span>}
                    {p.preferred && !p.booked && (
                      <span className="pick-hint" style={{ marginLeft: 0 }}>обычно ходит</span>
                    )}
                  </div>

                  <form action={toggleBooking}>
                    <input type="hidden" name="sessionId" value={p.session_id} />
                    <input type="hidden" name="participantId" value={p.participant_id} />
                    <input type="hidden" name="booked" value={p.booked ? '0' : '1'} />
                    <button
                      type="submit"
                      className={p.booked ? 'chip-on' : 'chip'}
                      aria-pressed={p.booked}
                      disabled={full || (past && !p.booked)}
                      style={{ ...signUp, opacity: full || (past && !p.booked) ? 0.45 : 1,
                               cursor: full || (past && !p.booked) ? 'default' : 'pointer' }}
                      aria-label={`${p.who}: ${
                        past && !p.booked ? 'занятие прошло'
                          : full ? 'мест нет'
                          : p.booked ? 'отменить запись' : 'записать'}`}
                    >
                      {p.booked ? 'Отменить' : 'Записать'}
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
