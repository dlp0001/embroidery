'use client';

import { useActionState, useState } from 'react';
import { addWalkInAction, saveJournal } from '@/app/admin/actions';
import { plural, type PayMethod } from '@/lib/format';
import type { PayWay, RosterRow } from '@/lib/studio';

/** Чек: не нужен или нужен, и тогда с тем способом, который назвала Варя. */
type Want = '' | PayMethod;

type Row = { present: boolean; pay: PayWay; receipt: Want };

/**
 * Способы по кругу, начиная с «без чека». Названия короткие и такие же,
 * как их произносят вслух: «битом», «пейбоксом», «переводом».
 */
const RECEIPTS: { key: Want; text: string }[] = [
  { key: '', text: 'без чека' },
  { key: 'cash', text: 'чек: наличные' },
  { key: 'bit', text: 'чек: bit' },
  { key: 'paybox', text: 'чек: paybox' },
  { key: 'transfer', text: 'чек: перевод' },
];

function receiptText(want: Want): string {
  return RECEIPTS.find((r) => r.key === want)?.text ?? 'без чека';
}

/** Ждём ли этого человека: родитель записал или день отмечен в профиле. */
function expected(r: RosterRow): boolean {
  return r.booked || r.preferred;
}

/** Родитель записал ребёнка именно на это занятие, а не «обычно ходит». */
function Booked({ on }: { on: boolean }) {
  if (!on) return null;
  return <div className="signed">записан</div>;
}

/** Абонемент можно выбрать, только если он есть или занятие уже на нём. */
function ways(r: RosterRow): PayWay[] {
  return r.has_pass || r.on_pass ? ['none', 'cash', 'pass'] : ['none', 'cash'];
}

/** Ребёнка привели, а родителя у него ещё нет: платить пока некому. */
function NoParent({ on }: { on: boolean }) {
  if (!on) return null;
  return <div className="money-off">родитель не привязан</div>;
}

/** Что уже проведено по деньгам: это и требует подтверждения при правке. */
function settledWay(r: RosterRow): PayWay | null {
  if (r.cash) return 'cash';
  if (r.on_pass) return 'pass';
  return null;
}

/**
 * Журнал одного занятия. Кто был — отмечает Варя, статус оплаты
 * подставляется сам: есть абонемент — «по абонементу», нет — «не оплачено».
 */
/** Что показываем до того, как Варя что-то тронула. */
function defaults(r: RosterRow): Row {
  return {
    present: r.status === 'present',
    // Про чек говорим только там, где о нём уже просили: сам собой он
    // не выписывается никогда.
    receipt: r.receipt === 'none' ? '' : (r.pay_method ?? ''),
    // Абонемент предлагаем только тем, кого сейчас отмечают впервые.
    // Занятие с уже проставленной отметкой — прошлое: подставлять ему
    // абонемент нельзя, иначе экран обещает списание, которого не было.
    pay: settledWay(r) ?? (!r.status && !r.locked && r.has_pass ? 'pass' : 'none'),
  };
}

export default function Journal({
  sessionId,
  roster,
  price,
  saved,
  kids = false,
  receipts = false,
  passWord = 'по абонементу',
}: {
  sessionId: string;
  roster: RosterRow[];
  price: string;
  saved: boolean;
  /** iCount подключён: без него просить чек не у кого. */
  receipts?: boolean;
  /** Как называется списание: у лагеря это пакет, а не абонемент. */
  passWord?: string;
  /** Детское занятие: сюда можно завести ребёнка прямо с порога. */
  kids?: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const rowFor = (r: RosterRow): Row => edits[r.participant_id] ?? defaults(r);

  // Строки с проведёнными деньгами открываются только после подтверждения.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<string | null>(null);

  // Отправка через useActionState: нужна и «сохраняю…», и отметка о том,
  // что сохранение уже прошло. Раньше про это говорил адрес страницы,
  // ради которого делался лишний переход.
  const [savedAt, submit, pending] = useActionState<number, FormData>(
    async (_prev, form) => {
      await saveJournal(form);
      return Date.now();
    },
    0,
  );

  const present = roster.filter((r) => rowFor(r).present).length;
  // Записавшиеся — первыми: их ждут наверняка, остальных по привычке.
  // Сортировка устойчивая, поэтому внутри каждой части имена по алфавиту.
  const likely = roster.filter(expected)
    .slice()
    .sort((a, b) => Number(b.booked) - Number(a.booked));
  const rest = roster.filter((r) => !expected(r));
  const split = likely.length > 0 && rest.length > 0;
  // В день лагеря в «Остальных» оказывается вся студия: ждут-то немногих,
  // а прийти может любой. Такой список закрывает собой журнал, поэтому
  // держим его свёрнутым — но только пока в нём никого не отметили.
  const touched = rest.some((r) => r.status !== null || r.cash || r.on_pass);
  const [restOpen, setRestOpen] = useState(touched);

  function moneyFor(r: RosterRow): { text: string; cls: string } | null {
    const row = rowFor(r);
    // Никого не отмечаем заранее. Пока человек не отмечен, про деньги
    // говорить нечего: «пропуск» пишем только там, где журнал уже закрыт.
    if (!row.present) return r.status ? { text: 'пропуск', cls: 'money-off' } : null;
    // Оплату картой из журнала не снять: деньги пришли через банк.
    if (r.paid && !r.cash) return { text: 'оплачено картой', cls: 'money' };
    if (row.pay === 'cash') return { text: 'оплачено наличными или переводом', cls: 'money' };
    if (row.pay === 'pass') return { text: passWord, cls: 'money' };
    return { text: `не оплачено · ${price}`, cls: 'money-due' };
  }

  function togglePresent(r: RosterRow) {
    const row = rowFor(r);
    setEdits((p) => ({ ...p, [r.participant_id]: { ...row, present: !row.present } }));
  }

  /** Клик по статусу оплаты гоняет его по кругу: три варианта или два. */
  function nextWay(r: RosterRow) {
    const list = ways(r);
    const row = rowFor(r);
    const at = list.indexOf(row.pay);
    const pay = list[(at + 1) % list.length];
    // Чек бывает только у денег, отданных в руки: ушли с наличных —
    // просьба о чеке уходит вместе с ними.
    setEdits((p) => ({
      ...p,
      [r.participant_id]: { ...row, pay, receipt: pay === 'cash' ? row.receipt : '' },
    }));
  }

  /** Клик по чеку перебирает способы: без чека, наличные, бит, пейбокс, перевод. */
  function nextReceipt(r: RosterRow) {
    const row = rowFor(r);
    const at = RECEIPTS.findIndex((x) => x.key === row.receipt);
    setEdits((p) => ({
      ...p,
      [r.participant_id]: { ...row, receipt: RECEIPTS[(at + 1) % RECEIPTS.length].key },
    }));
  }

  function line(r: RosterRow) {
    const row = rowFor(r);
    const m = moneyFor(r);
    const card = r.paid && !r.cash;
    const settled = Boolean(card || settledWay(r));
    // Чек выписан — строка закрыта навсегда: бумага уже у родителя и в
    // бухгалтерии, и снять по ней явку или переписать оплату нельзя.
    const billed = r.receipt === 'done';
    // Остальные проведённые деньги правку не запрещают, но спрашивают.
    const locked = billed || (settled && !unlocked.has(r.participant_id));
    const askingHere = asking === r.participant_id;

    /** Любое касание закрытой строки сначала спрашивает, потом делает. */
    const guard = (act: () => void) => () => {
      if (locked) setAsking(askingHere ? null : r.participant_id);
      else act();
    };

    return (
      <div key={r.participant_id}>
        <div className="mark">
          <input type="hidden" name={`mark:${r.participant_id}`} value={row.present ? 'present' : 'absent'} />
          <input type="hidden" name={`pay:${r.participant_id}`} value={row.pay} />
          <input type="hidden" name={`receipt:${r.participant_id}`} value={row.receipt} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <button type="button" className="plain" onClick={guard(() => togglePresent(r))}>
              <span className={row.present ? 'nm' : 'nm-off'}>{r.who}</span>
            </button>
            <Booked on={r.booked} />
            <NoParent on={!r.owner_id} />
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
              {m && (
                <button
                  type="button"
                  className={`chip-money ${m.cls}`}
                  disabled={!row.present || card || billed}
                  onClick={guard(() => nextWay(r))}
                >
                  {m.text}
                </button>
              )}
              {/* Чек просят прямо здесь: деньги уже в руках, а бумага
                  нужна не всем и не всегда. Выписанный показываем ссылкой:
                  по ней видно, что именно ушло родителю. */}
              {receipts && row.present && row.pay === 'cash' && (
                billed ? (
                  r.receipt_url ? (
                    <a className="chip-money money" href={r.receipt_url}
                       target="_blank" rel="noreferrer">чек выписан</a>
                  ) : (
                    <span className="chip-money money">чек выписан</span>
                  )
                ) : (
                  <button
                    type="button"
                    className={`chip-money ${row.receipt ? 'money' : 'money-off'}`}
                    onClick={guard(() => nextReceipt(r))}
                  >
                    {receiptText(row.receipt)}
                    {r.receipt === 'wanted' && ' · не вышел'}
                  </button>
                )
              )}
            </div>
          </div>

          <button
            type="button"
            aria-label={`${r.who}: ${row.present ? 'снять отметку' : 'отметить'}`}
            aria-pressed={row.present}
            className={row.present ? 'dot-on' : 'dot-off'}
            onClick={guard(() => togglePresent(r))}
          >
            {row.present && (
              <svg viewBox="0 0 24 24">
                <path d="M4 12.5 L9.5 18 L20 6" />
              </svg>
            )}
          </button>
        </div>

        {askingHere && (
          <div className="note" style={{ margin: '0 0 14px' }}>
            {billed ? (
              <>
                По этому занятию выписан чек. Снять отметку и поменять оплату
                из журнала уже нельзя: бумага ушла родителю и в бухгалтерию.
                Если всё-таки надо — сначала отменяется чек, и делает это Дима.
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn-quiet" onClick={() => setAsking(null)}>
                    Понятно
                  </button>
                </div>
              </>
            ) : (
              <>
                По этому занятию деньги уже проведены. Изменение попадёт в реестр
                и будет видно, кто его сделал.
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setUnlocked((p) => new Set(p).add(r.participant_id));
                      setAsking(null);
                    }}
                  >
                    Всё равно изменить
                  </button>
                  <button type="button" className="btn-quiet" onClick={() => setAsking(null)}>
                    Отмена
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <form action={submit}>
      <input type="hidden" name="sessionId" value={sessionId} />

      {/* Заголовки нужны, только когда список действительно разделён */}
      {likely.length > 0 && (
        <>
          {split && <div className="lbl" style={{ marginTop: 6 }}>Ждём</div>}
          {likely.map(line)}
        </>
      )}

      {rest.length > 0 && (
        <>
          {split && (
            <button
              type="button"
              className="lbl"
              onClick={() => setRestOpen((v) => !v)}
              aria-expanded={restOpen}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                       background: 'none', border: 0, padding: 0, cursor: 'pointer',
                       fontFamily: 'inherit', textAlign: 'left' }}
            >
              <span aria-hidden style={{ fontSize: 8 }}>{restOpen ? '▼' : '▶'}</span>
              Остальные · {rest.length} {plural(rest.length, 'человек', 'человека', 'человек')}
            </button>
          )}
          {/* Свёрнутый список прячем показом, а не удалением: строки
              остаются в форме, и сохранение не стирает отметки тех,
              кого сейчас не видно. */}
          <div style={{ display: split && !restOpen ? 'none' : undefined }}>
            {rest.map(line)}
          </div>
        </>
      )}

      <button className="btn-wide" type="submit" style={{ marginTop: 14 }} disabled={pending}>
        {pending
          ? 'Сохраняю…'
          : `${saved ? 'Пересохранить' : 'Сохранить'} · отмечено ${present}`}
      </button>
      {savedAt > 0 && !pending && (
        <p className="hint" style={{ marginTop: 12 }}>Сохранено.</p>
      )}
      {unlocked.size > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          Открыто для правки: {unlocked.size}. После сохранения изменение появится в реестре.
        </p>
      )}
      </form>

      {kids && (
        <form
          action={addWalkInAction}
          style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 18 }}
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor={`walkin-${sessionId}`}>Привели нового</label>
            <input
              id={`walkin-${sessionId}`}
              name="name"
              maxLength={120}
              placeholder="Имя и фамилия"
            />
          </div>
          <button className="btn-quiet" type="submit">Добавить</button>
        </form>
      )}
    </>
  );
}
