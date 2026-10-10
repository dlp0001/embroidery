import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, isAdmin, isSuperadmin } from '@/lib/session';
import { abandoned, buyers, type Buyer } from '@/lib/course-admin';
import { legacyBuyers, legacyWithoutOrder, type LegacySheet } from '@/lib/course-legacy';
import { MAX_DEVICES } from '@/lib/course-limits';
import { money, shortDate } from '@/lib/format';
import {
  backfillLegacyAction, grantCourseAction, importLegacyAction, resendLinkAction, resetDevicesAction, restoreAction, revokeAction,
  retryReceiptAction,
} from '@/app/admin/course-actions';

export const dynamic = 'force-dynamic';
// Перенос первого потока пишет письма по одному, с паузой: ему нужно время.
export const maxDuration = 60;

const SOURCE: Record<Buyer['source'], string> = {
  purchase: 'купил',
  manual: 'выдан вручную',
  legacy: 'с первого потока',
};

const PROVIDER: Record<string, string> = {
  payplus: 'PayPlus',
  polar: 'Polar',
  yookassa: 'ЮKassa',
  paddle: 'Paddle',
  lemonsqueezy: 'Lemon Squeezy',
  sheet: 'по таблице',
};

/** «Первый поток · Polar · 240 ₪ · оплата 02.06.26» или «PayPlus · 180 ₪ · с 10.10.26». */
function paidLine(b: Buyer): string {
  const parts: string[] = [];
  if (b.source === 'legacy') parts.push('Первый поток');
  if (b.provider) {
    parts.push(PROVIDER[b.provider] ?? b.provider);
    if (b.amount) parts.push(money(b.amount, b.currency ?? 'ILS'));
  } else if (b.source !== 'legacy') {
    parts.push(SOURCE[b.source]);
  }
  parts.push(b.source === 'legacy' && b.paid_on ? `оплата ${shortDate(b.paid_on)}` : `с ${shortDate(b.since)}`);
  return parts.join(' · ');
}

/**
 * Покупатели видеокурса. Студия здесь ни при чём: это отдельные люди,
 * они не заводятся в «Людях» и не попадают в журнал и рассылки.
 */
export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; error?: string; legacy?: string }>;
}) {
  const user = await currentUser();
  if (!user || !isAdmin(user)) redirect('/admin/studio');
  const { note, error, legacy } = await searchParams;
  const boss = isSuperadmin(user);

  const [list, lost, noSum] = await Promise.all([
    buyers('embroidery'), abandoned('embroidery'), boss ? legacyWithoutOrder('embroidery') : 0,
  ]);

  // Таблицу читаем только по просьбе: это поход в Google на каждый заход.
  let sheet: LegacySheet | null = null;
  let sheetError: string | null = null;
  if (boss && legacy) {
    try {
      sheet = await legacyBuyers('embroidery');
    } catch (err) {
      sheetError = err instanceof Error ? err.message : 'таблица не открылась';
    }
  }
  const todo = sheet?.buyers.filter((b) => !b.hasAccess) ?? [];
  const active = list.filter((b) => !b.expired && !b.revoked);

  return (
    <>
      <div className="top">
        <div className="kicker">
          <Link href="/admin/studio/admin" style={{ color: 'inherit' }}>Админ</Link> · Курс
        </div>
        <h1 className="h1">Курс вышивки</h1>
        <p className="sub">
          Доступ сейчас у {active.length} из {list.length}.{' '}
          <a href="/learn/embroidery" target="_blank">Страница курса</a>
        </p>
      </div>

      <div className="body">
        {note && <p className="note" style={{ marginBottom: 14 }}>{note}</p>}
        {error && <p className="err" style={{ marginBottom: 14 }}>{error}</p>}

        <div className="card">
          <div className="what" style={{ marginBottom: 6 }}>Открыть доступ вручную</div>
          <p className="hint" style={{ marginBottom: 14 }}>
            Подарок или оплата мимо сайта. Доступ на 6 месяцев, письмо со ссылкой уйдёт сразу.
            Если доступ уже есть, срок продлится.
          </p>
          <form action={grantCourseAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="grant-email">Почта</label>
              <input id="grant-email" name="email" type="email" required placeholder="anna@example.com" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="grant-name">Имя, если знаете</label>
              <input id="grant-name" name="name" placeholder="Анна" />
            </div>
            <button className="btn-wide" type="submit">Открыть и отправить ссылку</button>
          </form>
        </div>

        {boss && (
          <div className="card" style={{ borderStyle: 'dashed' }}>
            <div className="what" style={{ marginBottom: 6 }}>Первый поток из таблицы</div>
            <p className="hint" style={{ marginBottom: 14 }}>
              Оплатившие из Google Sheets получают доступ на 6 месяцев и письмо «записи переехали»
              со ссылкой. У кого доступ уже есть, того не трогаем, так что нажимать можно снова, если
              в таблице появятся новые оплатившие.
            </p>
            {noSum > 0 && (
              <form action={backfillLegacyAction} style={{ marginBottom: 12 }}>
                <p className="hint" style={{ marginBottom: 10 }}>
                  У {noSum} перенесённых в карточке нет суммы оплаты: их переносили до того,
                  как суммы научились сохранять.
                </p>
                <button className="btn-quiet" type="submit">Подтянуть суммы из таблицы</button>
              </form>
            )}
            {!legacy ? (
              <Link className="btn-quiet" href="/admin/courses?legacy=1">Проверить таблицу</Link>
            ) : sheetError ? (
              <p className="err">Таблица не открылась: {sheetError}</p>
            ) : sheet && (
              <>
                <p className="hint" style={{ marginBottom: 10 }}>
                  Оплатили {sheet.buyers.length}, доступ уже есть у {sheet.buyers.length - todo.length},
                  перенести {todo.length}.
                  {Object.keys(sheet.skipped).length > 0 && (
                    <> Не взяты: {Object.entries(sheet.skipped).map(([s, n]) => `«${s}» — ${n}`).join(', ')}.</>
                  )}
                </p>
                {todo.slice(0, 50).map((b) => (
                  <div className="money" key={b.email} style={{ overflowWrap: 'anywhere' }}>
                    {b.email}{b.name ? ` · ${b.name}` : ''} · {b.date.split(',')[0]} · {b.amount} {b.currency}
                  </div>
                ))}
                {todo.length > 50 && <div className="money">…и ещё {todo.length - 50}</div>}
                {todo.length > 0 && (
                  <form action={importLegacyAction} style={{ marginTop: 14 }}>
                    <button className="btn-wide" type="submit">
                      Открыть доступ и написать {Math.min(todo.length, 20)}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        )}

        <div className="lbl">Покупатели</div>
        {list.length === 0 && <p className="hint">Пока никого.</p>}
        {list.map((b) => (
          <div className="card" key={b.id} style={b.expired || b.revoked ? { opacity: 0.6 } : undefined}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="what" style={{ fontSize: 19, overflowWrap: 'anywhere' }}>{b.name || b.email}</div>
                {b.name && <div className="sub" style={{ overflowWrap: 'anywhere' }}>{b.email}</div>}
                <div className="money">{paidLine(b)}</div>
                <div className="money">
                  Устройств {b.devices} из {MAX_DEVICES}
                  {b.link_sent ? ` · ссылка ${shortDate(b.link_sent)}` : ''}
                </div>
                {b.provider === 'payplus' && (
                  b.receipt_url ? (
                    <div className="money">
                      {b.receipt_url.startsWith('http')
                        ? <a href={b.receipt_url} target="_blank">Квитанция</a>
                        : 'Квитанция выписана'}
                    </div>
                  ) : b.receipt_error ? (
                    <div className="money-due">Квитанция не выписана: {b.receipt_error}</div>
                  ) : null
                )}
              </div>
              <span className={b.expired || b.revoked ? 'tag tag-due' : 'tag tag-ok'}>
                {b.revoked ? 'отозван' : b.expired ? `до ${shortDate(b.until)}` : `до ${shortDate(b.until)}`}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {!b.revoked && !b.expired && (
                <form action={resendLinkAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="btn-quiet" type="submit">Прислать ссылку</button>
                </form>
              )}
              {b.devices > 0 && !b.revoked && (
                <form action={resetDevicesAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="btn-quiet" type="submit">Сбросить устройства</button>
                </form>
              )}
              {b.provider === 'payplus' && !b.receipt_url && b.payplus_id && (
                <form action={retryReceiptAction}>
                  <input type="hidden" name="payplusId" value={b.payplus_id} />
                  <button className="btn-quiet" type="submit">Выписать квитанцию</button>
                </form>
              )}
              {b.revoked ? (
                <form action={restoreAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="btn-quiet" type="submit">Вернуть доступ</button>
                </form>
              ) : (
                <form action={revokeAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="btn-quiet" type="submit">Отозвать</button>
                </form>
              )}
            </div>
          </div>
        ))}

        {lost.length > 0 && (
          <>
            <div className="lbl">Дошли до оплаты и не заплатили · 30 дней</div>
            {lost.map((l) => (
              <div className="card" key={l.email + l.at}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ overflowWrap: 'anywhere' }}>{l.name ? `${l.name} · ` : ''}{l.email}</div>
                    <div className="money">{PROVIDER[l.provider] ?? l.provider} · {money(l.amount, l.currency)}</div>
                  </div>
                  <span className="tag tag-ok">{l.at}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
