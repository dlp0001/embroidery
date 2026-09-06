import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { ledger, type MoneyKind } from '@/lib/ledger';
import { dayMonth, money } from '@/lib/format';
import { STUDIO_TZ } from '@/lib/time';

export const dynamic = 'force-dynamic';

const KIND: Record<MoneyKind, { text: string; good: boolean }> = {
  charge_created: { text: 'занятие в долг', good: false },
  charge_removed: { text: 'начисление снято', good: true },
  charge_on_pass: { text: 'списано с абонемента', good: true },
  cash_taken: { text: 'приняты наличные', good: true },
  cash_reverted: { text: 'наличные отменены', good: false },
  pass_issued: { text: 'продан абонемент', good: true },
  pass_covered_debt: { text: 'долг закрыт абонементом', good: true },
  payment_paid: { text: 'оплачено картой', good: true },
  cash_declared: { text: 'заявлена оплата наличными', good: false },
  cash_confirmed: { text: 'наличные подтверждены', good: true },
  cash_declined: { text: 'заявка отклонена', good: false },
};

function when(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: STUDIO_TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export default async function LedgerPage() {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Реестр</h1>
        </div>
        <div className="body"><p className="hint">Раздел доступен админу.</p></div>
      </>
    );
  }

  const rows = await ledger(150);

  return (
    <>
      <div className="top">
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 10 }}>
          <Link href="/admin/studio/debts" style={{ color: 'var(--warm-gray)' }}>Деньги</Link> · реестр
        </div>
        <h1 className="h1">Реестр</h1>
        <p className="sub">Каждое движение денег: что, с кем, когда и по чьей руке</p>
      </div>

      <div className="body">
        {rows.length === 0 && <p className="hint">Пока пусто.</p>}

        {rows.map((r) => {
          const k = KIND[r.kind] ?? { text: r.kind, good: true };
          return (
            <div className="card" key={r.id}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="when">{when(r.at)}</div>
                  <div className="what">{k.text}</div>
                  <div className="sub">
                    {[r.who, r.group_title, r.held_on ? dayMonth(r.held_on) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {r.owner && <div className="sub">счёт: {r.owner}</div>}
                  <div className="sub">{r.actor ? `отметил: ${r.actor}` : 'автоматически'}</div>
                </div>
                {r.amount && (
                  <div style={{
                    fontFamily: "'Cormorant Garamond', serif", fontSize: 20,
                    color: k.good ? 'var(--charcoal)' : 'var(--rose-dark)',
                    whiteSpace: 'nowrap',
                  }}>
                    {money(r.amount, r.currency ?? 'ILS')}
                  </div>
                )}
              </div>
              {r.note && <div className="hint" style={{ marginTop: 8 }}>{r.note}</div>}
            </div>
          );
        })}

        <p className="hint" style={{ marginTop: 18 }}>
          Показаны последние {rows.length}. Записи не редактируются и не удаляются.
        </p>
      </div>
    </>
  );
}
