import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { paymentsTaken, type TakenRow } from '@/lib/billing';
import { money, plural, WAY, type PayMethod } from '@/lib/format';
import { STUDIO_TZ } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** Только время: день уже написан над кучкой платежей. */
function when(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: STUDIO_TZ, hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** Дата без времени: по ней платежи собираются в кучки по дням. */
function day(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: STUDIO_TZ, day: 'numeric', month: 'long',
  }).format(new Date(iso));
}

/**
 * Чем заплатили. Способ помнит сам платёж; у старых его нет, и тогда
 * остаётся провайдер: карта — это карта, остальное принимала студия, а
 * чем именно — уже не узнать.
 */
function how(p: TakenRow): string {
  const m = p.pay_method as PayMethod | null;
  if (m === 'bit' || m === 'paybox') return WAY[m];
  if (m) return WAY[m];
  if (p.provider === 'payplus') return 'картой';
  return 'способ не записан';
}

/** За что заплачено: занятия, абонемент, пакет смены или докупленные дни. */
function what(p: TakenRow): string {
  if (p.extra_days > 0) {
    return `${p.group_title ? `${p.group_title}: ` : ''}докуплено ${p.extra_days} ${
      plural(p.extra_days, 'день', 'дня', 'дней')}`;
  }
  if (p.purpose === 'studio_pass') {
    return p.group_title
      ? `${p.group_title}: пакет на ${p.lessons} ${plural(p.lessons, 'день', 'дня', 'дней')}`
      : `абонемент на ${p.lessons} ${plural(p.lessons, 'занятие', 'занятия', 'занятий')}`;
  }
  if (p.lessons > 0) {
    return `${p.lessons} ${plural(p.lessons, 'занятие', 'занятия', 'занятий')}`;
  }
  return 'оплата';
}

/**
 * Полученные деньги, подряд и по дням. Реестр рядом отвечает на вопрос
 * «что происходило», а здесь только то, что дошло до кассы и до счёта:
 * по этой странице сходятся с банком и с тем, что лежит в конверте.
 */
export default async function PaymentsPage() {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Платежи</h1>
        </div>
        <div className="body"><p className="hint">Раздел доступен админу.</p></div>
      </>
    );
  }

  const rows = await paymentsTaken(150);
  const currency = rows[0]?.currency ?? 'ILS';
  const total = rows.reduce((s, p) => s + Number(p.amount), 0);

  // Кучки по дням: за день обычно приходит два-три платежа, и дневной
  // итог — то, что сверяют с кошельком вечером.
  const days: { label: string; rows: TakenRow[] }[] = [];
  for (const p of rows) {
    const label = day(p.at);
    const last = days[days.length - 1];
    if (last && last.label === label) last.rows.push(p);
    else days.push({ label, rows: [p] });
  }

  return (
    <>
      <div className="top">
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 10 }}>
          <Link href="/admin/studio/debts" style={{ color: 'var(--warm-gray)' }}>Деньги</Link> · платежи
        </div>
        <h1 className="h1">Платежи</h1>
        <p className="sub">Только полученные деньги: начатое и отклонённое сюда не попадает</p>
      </div>

      <div className="body">
        {rows.length === 0 && <p className="hint">Пока ничего не получено.</p>}

        {days.map((d) => {
          const sum = d.rows.reduce((s, p) => s + Number(p.amount), 0);
          return (
            <div key={d.label}>
              <div className="lbl" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{d.label}</span>
                <span>{money(sum, currency)}</span>
              </div>
              {d.rows.map((p) => (
                <div className="card" key={p.id}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div className="what">{p.who}</div>
                      <div className="sub">{what(p)} · {how(p)}</div>
                      <div className="sub">{when(p.at)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="sum">{money(p.amount, p.currency)}</div>
                      {p.invoice_url && (
                        <a className="hint" href={p.invoice_url} target="_blank" rel="noreferrer">
                          чек
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {rows.length > 0 && (
          <p className="hint" style={{ marginTop: 18 }}>
            Показаны последние {rows.length}&nbsp;{plural(rows.length, 'платёж', 'платежа', 'платежей')} на {money(total, currency)}.
            Подарки не в счёт: денег за ними нет. Каждое движение, включая
            отменённое, — в <Link href="/admin/studio/ledger">реестре</Link>.
          </p>
        )}
      </div>
    </>
  );
}
