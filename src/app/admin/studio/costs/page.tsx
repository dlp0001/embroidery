import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { expensesIn, linesOf, spentByKind, splitsFor, type ListRow } from '@/lib/expenses';
import { setLineKindAction } from '@/app/admin/cost-actions';
import Lines from './Lines';
import { cents, dayMonth, plural, todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function bounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function before(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Машинные группы строк по-русски: в них чек разложен «примерно». */
const GUESS_WORD: Record<string, string> = {
  materials: 'материалы',
  stationery: 'канцелярия',
  equipment: 'оборудование',
  food: 'еда',
  other: 'прочее',
};

/** Что с чеком: ждёт решения, проведён или отклонён. */
function state(e: ListRow): { text: string; cls: string } {
  if (e.status === 'done') {
    return { text: e.icount_id ? `в iCount № ${e.icount_id}` : 'проведён', cls: 'money' };
  }
  if (e.status === 'dropped') return { text: 'не проводим', cls: 'money-off' };
  return { text: 'ждёт статьи', cls: 'money-due' };
}

/**
 * Расходы студии: чеки, снятые на телефон, и сколько по ним ушло.
 *
 * Деньги сюда попадают не отсюда: Варя отправляет снимок боту, тот
 * разбирает его и спрашивает статью затрат одной кнопкой. Эта страница —
 * чтобы видеть накопившееся и разбирать то, что бот не осилил.
 */
export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Расходы</h1>
        </div>
        <div className="body"><p className="hint">Раздел доступен админу.</p></div>
      </>
    );
  }

  const params = await searchParams;
  const now = bounds(todayISO().slice(0, 7));
  const from = DATE.test(params.from ?? '') ? params.from! : now.from;
  const to = DATE.test(params.to ?? '') ? params.to! : now.to;

  const [byKind, rows] = await Promise.all([spentByKind(from, to), expensesIn(from, to)]);
  // Разбор по строкам: показания модели, а не решение человека. Поэтому
  // стоит мелко, под суммой, и ни во что не суммируется.
  const ids = rows.map((r) => r.id);
  const [splits, lines] = await Promise.all([splitsFor(ids), linesOf(ids)]);
  const total = byKind.reduce((s, r) => s + Number(r.sum), 0);
  const waiting = rows.filter((r) => r.status === 'new');

  const months: string[] = [];
  for (let m = todayISO().slice(0, 7), i = 0; i < 6; i++, m = before(m)) months.push(m);

  return (
    <>
      <div className="top">
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 10 }}>
          <Link href="/admin/studio/debts" style={{ color: 'var(--warm-gray)' }}>Деньги</Link> · расходы
        </div>
        <h1 className="h1">Расходы</h1>
        <p className="sub">Чек фотографируют боту — он разбирает и спрашивает статью</p>
      </div>

      <div className="body">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {months.map((m) => {
            const b = bounds(m);
            const on = from === b.from && to === b.to;
            return (
              <Link key={m} href={`/admin/studio/costs?from=${b.from}&to=${b.to}`}
                    className={`${on ? 'chip-on' : 'chip'} chip-sm`}>
                {MONTHS[Number(m.slice(5)) - 1]}
                {m.slice(0, 4) === todayISO().slice(0, 4) ? '' : ` ${m.slice(0, 4)}`}
              </Link>
            );
          })}
        </div>

        {byKind.length === 0 ? (
          <p className="hint">За эти дни расходов не проведено.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rep">
              <thead>
                <tr>
                  <th>Статья</th>
                  <th>Чеков</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {byKind.map((r) => (
                  <tr key={r.kind_id ?? 'none'}>
                    <td>{r.kind_title ?? 'без статьи'}</td>
                    <td>{r.n}</td>
                    <td>{cents(r.sum, 'ILS')}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Итого</td>
                  <td>{byKind.reduce((s, r) => s + r.n, 0)}</td>
                  <td>{cents(total, 'ILS')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {waiting.length > 0 && (
          <p className="note" style={{ marginTop: 16 }}>
            {waiting.length}&nbsp;{plural(waiting.length, 'чек', 'чека', 'чеков')} ждёт
            статьи затрат: статью выбирают кнопкой в боте, под тем же снимком.
          </p>
        )}

        <div className="lbl" style={{ marginTop: 26 }}>Чеки</div>
        {rows.length === 0 && <p className="hint">Пока ни одного.</p>}
        {rows.map((e) => {
          const st = state(e);
          return (
            <div className="card" key={e.id}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="what">
                    {e.trade_name_en && e.trade_name
                      ? `${e.trade_name_en} | ${e.trade_name}`
                      : e.trade_name_en ?? e.trade_name ?? e.supplier ?? 'поставщик не разобран'}
                  </div>
                  {e.trade_name && e.supplier && (
                    <div className="sub">{e.supplier}</div>
                  )}
                  <div className="sub">
                    {[
                      e.spent_on ? dayMonth(e.spent_on) : 'дата не разобрана',
                      e.doc_number ? `№ ${e.doc_number}` : null,
                      e.kind_title,
                    ].filter(Boolean).join(' · ')}
                  </div>
                  {(() => {
                    const parts = splits.get(e.id) ?? [];
                    if (parts.length === 0) {
                      return e.what ? <div className="sub">{e.what}</div> : null;
                    }
                    return (
                      <div className="sub">
                        {parts.map((p) => `${GUESS_WORD[p.kind] ?? p.kind} ${
                          cents(p.sum, e.currency)}`).join(' · ')}
                      </div>
                    );
                  })()}
                  <div className={st.cls} style={{ marginTop: 6 }}>{st.text}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="sum">
                    {e.amount ? cents(e.amount, e.currency) : <span className="dim">—</span>}
                  </div>
                  {e.has_photo && (
                    <a className="hint" href={`/admin/studio/costs/photo/${e.id}`}
                       target="_blank" rel="noreferrer">снимок</a>
                  )}
                </div>
              </div>

              {/* Строки под чеком: раскрываются нажатием, группу у любой
                  можно поменять руками. */}
              <Lines
                lines={lines.get(e.id) ?? []}
                action={setLineKindAction}
                total={e.amount === null ? null : Number(e.amount)}
              />
            </div>
          );
        })}

        <p className="hint" style={{ marginTop: 18 }}>
          В iCount расход уходит одной суммой и той статьёй, которую
          выбрали: наша статья знает, каким видом расхода она там
          становится. Строки чека хранятся только у нас — мелкая строка
          под суммой это их разбор по группам, сделанный моделью. Он ни во
          что не суммируется: это материал для будущих отчётов, а не
          проведённые деньги.
        </p>
      </div>
    </>
  );
}
