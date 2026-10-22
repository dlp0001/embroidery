/**
 * Когда Isracard переведёт деньги за оплату картой и сколько дойдёт.
 *
 * PayPlus для студии только касса: деньги переводит Isracard прямо на
 * счёт, и ни у кого из них нет API, который сказал бы «2-го придёт
 * столько-то». Поэтому график считаем сами, по договору с Isracard
 * (бит-эсек 5668307, подписан 18 мая 2026, часть ה):
 *
 * - принятое Isracard с 1-го по 15-е приходит 2-го числа следующего
 *   месяца, принятое с 16-го до конца месяца — 8-го;
 * - рассрочка приходит частями: первый платёж по тому же правилу,
 *   остальные — в то же число следующих месяцев. Досрочно не платят:
 *   дисконтирование в договоре не подключено;
 * - из каждой выплаты вычитают комиссию и НДС на неё.
 *
 * Сверять с кабинетом Isracard, раздел זיכויים עתידיים: там тот же
 * график, посчитанный ими самими по уже принятым продажам.
 */

import { query } from './db';
import { plusDays, todayISO } from './format';
import { fetchTransaction, type PayPlan } from './payplus';
import { STUDIO_TZ } from './time';

// ── Рабочие дни банков ────────────────────────────────────

const HEBREW = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  timeZone: 'UTC', month: 'long', day: 'numeric',
});

function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Дата по еврейскому календарю: праздники считаются по нему, а не таблицей. */
function hebrew(iso: string): { month: string; day: number } {
  const parts = HEBREW.formatToParts(new Date(`${iso}T00:00:00Z`));
  return {
    month: parts.find((p) => p.type === 'month')?.value ?? '',
    day: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

/**
 * Дни, которые надзор над банками закроет сверх праздников: выборы и
 * всё, что объявят особо. Заранее их не знать, вписывать по факту.
 */
const ALSO_CLOSED: string[] = [];

/**
 * Рабочий ли день у банков. Выходные — из определения рабочего дня в
 * договоре: суббота, два дня Рош а-Шана, канун Йом Кипура и сам Йом
 * Кипур, первый день Суккота и Шмини Ацерет, Пурим, первый и седьмой
 * дни Песаха, День независимости, Шавуот и 9 Ава. Пятница и канун
 * праздника — рабочие.
 */
export function isBankDay(iso: string): boolean {
  const wd = weekday(iso);
  if (wd === 6 || ALSO_CLOSED.includes(iso)) return false;
  const { month, day } = hebrew(iso);
  switch (month) {
    case 'Tishri': return ![1, 2, 9, 10, 15, 22].includes(day);
    // В високосный год Пурим во втором Адаре.
    case 'Adar': case 'Adar II': return day !== 14;
    case 'Nisan': return day !== 15 && day !== 21;
    // День независимости с пятницы и субботы празднуют в четверг,
    // с понедельника — во вторник.
    case 'Iyar': return !(
      (day === 5 && wd === 3) || ((day === 3 || day === 4) && wd === 4) || (day === 6 && wd === 2));
    case 'Sivan': return day !== 6;
    // 9 Ава в субботу переносится на воскресенье.
    case 'Av': return !(day === 9 || (day === 10 && wd === 0));
    default: return true;
  }
}

/** Ближайший рабочий день банка, считая сам день. */
function bankDayFrom(iso: string): string {
  let d = iso;
  while (!isBankDay(d)) d = plusDays(d, 1);
  return d;
}

// ── Правило выплат ────────────────────────────────────────

/**
 * Каким днём Isracard считает продажу принятой. По договору это день,
 * когда продажа дошла до их систем, а дошедшее после 14:00 (в пятницу и
 * канун праздника — после 11:30) или в выходной считается следующим
 * рабочим днём. PayPlus передаёт продажи пачкой раз в сутки, вечером или
 * ночью, поэтому продажа любого часа ложится на следующий рабочий день.
 *
 * Это допущение: про PayPlus в договоре ничего нет. Проверяется сверкой
 * прошедших выплат с выпиской — расходиться будут продажи 14–15-го и
 * последних дней месяца.
 */
export function capturedOn(saleDay: string): string {
  return bankDayFrom(plusDays(saleDay, 1));
}

/**
 * Даты выплат по продаже. due — 2-е или 8-е по договору, day — когда
 * деньги придут на самом деле: выпавшую на выходной выплату считаем
 * перенесённой на следующий рабочий день. Договор об этом молчит, так
 * поступают банки.
 */
export function payoutDays(captured: string, count: number): { due: string; day: string }[] {
  const [y, m, d] = captured.split('-').map(Number);
  const dom = d <= 15 ? 2 : 8;
  return Array.from({ length: count }, (_, k) => {
    // m с единицы, а Date.UTC ждёт месяц с нуля: m — это уже следующий.
    const due = new Date(Date.UTC(y, m + k, dom)).toISOString().slice(0, 10);
    return { due, day: bankDayFrom(due) };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Суммы платежей по продаже. Без разбивки от PayPlus делим поровну, а
 * остаток агорот кладём в первый платёж.
 */
export function instalments(amount: number, plan: PayPlan | null): number[] {
  const n = Math.max(1, Math.round(plan?.payments ?? 1));
  if (n === 1) return [amount];
  const rest = plan?.rest && plan.rest > 0 ? plan.rest : Math.floor((amount * 100) / n) / 100;
  return [round2(amount - rest * (n - 1)), ...Array<number>(n - 1).fill(rest)];
}

/**
 * Комиссия Isracard без НДС, договор, часть ה, п. 3. Рассрочка от 2 до
 * 12 платежей надбавки не стоит.
 */
export const RATES = { local: 0.012, amex: 0.0165, foreign: 0.0325 } as const;

/** НДС на комиссию: его платит и освобождённый от НДС бизнес. */
export const VAT = 0.18;

export type CardKind = keyof typeof RATES;

/** Карта неизвестного происхождения считается израильской: их большинство. */
function cardKind(plan: PayPlan | null): CardKind {
  if (plan?.foreign) return 'foreign';
  if (plan?.brand && /amex|american/i.test(plan.brand)) return 'amex';
  return 'local';
}

// ── График ────────────────────────────────────────────────

export type Credit = {
  saleId: string;
  source: 'studio' | 'course';
  who: string;
  saleDay: string;
  /** Этот платёж, до комиссии. */
  amount: number;
  /** Платёж part из parts. У обычной оплаты оба равны 1. */
  part: number;
  parts: number;
  /** Комиссия вместе с НДС. */
  fee: number;
  kind: CardKind;
  /** PayPlus разбивку не сообщил: считаем одним платежом с израильской карты. */
  guessed: boolean;
};

export type Payout = {
  /** Когда деньги придут. */
  day: string;
  /** 2-е или 8-е по договору: по нему видно, за какую половину месяца. */
  due: string;
  gross: number;
  fee: number;
  net: number;
  credits: Credit[];
};

export type PayoutPlan = {
  past: Payout[];
  upcoming: Payout[];
  /** Продажи, про которые PayPlus ещё не спрашивали. */
  unasked: number;
};

type SaleRow = {
  id: string;
  source: 'studio' | 'course';
  who: string;
  amount: string;
  day: string;
  plan: PayPlan | null;
};

/**
 * Продажи картой через PayPlus: студия и видеокурс. Терминал у них один,
 * значит, и договор с Isracard один, и выплаты общие.
 */
function cardSales(since: string): Promise<SaleRow[]> {
  return query<SaleRow>(
    `select p.id, 'studio' as source, coalesce(u.name, u.email, 'без плательщика') as who,
            p.amount::text, to_char(p.created_at at time zone $2, 'YYYY-MM-DD') as day,
            p.raw -> 'plan' as plan
       from payments p left join users u on u.id = p.user_id
      where p.provider = 'payplus' and p.status = 'paid' and p.created_at >= $1::date
     union all
     select o.id, 'course', coalesce(a.name, a.email::text), o.amount::text,
            to_char(o.created_at at time zone $2, 'YYYY-MM-DD'), o.raw -> 'plan'
       from course_orders o join course_access a on a.id = o.access_id
      where o.provider = 'payplus' and o.amount > 0 and o.created_at >= $1::date`,
    [since, STUDIO_TZ],
  );
}

/** Сколько прошедших выплат показывать для сверки с выпиской. */
const PAST_SHOWN = 3;

export async function payoutPlan(today = todayISO()): Promise<PayoutPlan> {
  // Рассрочка до 12 месяцев: хвосты продаж годовой давности ещё идут.
  const [sales, notAsked] = await Promise.all([cardSales(plusDays(today, -460)), unasked()]);

  const byDay = new Map<string, Payout>();
  for (const s of sales) {
    // День оплаты по часам PayPlus точнее нашего: страницу могли открыть
    // накануне, а заплатить утром.
    const saleDay = /^\d{4}-\d{2}-\d{2}/.test(s.plan?.date ?? '') ? s.plan!.date!.slice(0, 10) : s.day;
    const kind = cardKind(s.plan);
    const parts = instalments(Number(s.amount), s.plan);
    const days = payoutDays(capturedOn(saleDay), parts.length);

    parts.forEach((amount, i) => {
      const { due, day } = days[i];
      const fee = round2(amount * RATES[kind] * (1 + VAT));
      const payout = byDay.get(day) ?? { day, due, gross: 0, fee: 0, net: 0, credits: [] };
      payout.credits.push({
        saleId: s.id, source: s.source, who: s.who, saleDay, amount,
        part: i + 1, parts: parts.length, fee, kind,
        guessed: !s.plan || s.plan.payments == null,
      });
      payout.gross = round2(payout.gross + amount);
      payout.fee = round2(payout.fee + fee);
      payout.net = round2(payout.gross - payout.fee);
      byDay.set(day, payout);
    });
  }

  const all = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  for (const p of all) p.credits.sort((a, b) => a.saleDay.localeCompare(b.saleDay));
  return {
    past: all.filter((p) => p.day < today).slice(-PAST_SHOWN).reverse(),
    upcoming: all.filter((p) => p.day >= today),
    unasked: notAsked.length,
  };
}

// ── Разбивка для старых продаж ────────────────────────────

/**
 * Продажи, про которые PayPlus ещё не спрашивали. Курс хранит в raw весь
 * ответ кассы, и там plan бывает null — это тоже «не знаем».
 */
function unasked(): Promise<{ id: string; source: 'studio' | 'course'; provider_id: string }[]> {
  return query(
    `select id, 'studio' as source, provider_id from payments
      where provider = 'payplus' and status = 'paid' and provider_id is not null
        and jsonb_typeof(raw -> 'plan') is distinct from 'object'
     union all
     select id, 'course', provider_id from course_orders
      where provider = 'payplus' and amount > 0
        and jsonb_typeof(raw -> 'plan') is distinct from 'object'`,
  );
}

/** Ответ PayPlus по одной продаже. undefined — не нашёл или не ответил. */
async function askOne(providerId: string): Promise<PayPlan | null | undefined> {
  // Студия после оплаты хранит id транзакции, а если обратный вызов его
  // не принёс — id платёжной страницы. Спрашиваем по очереди обоими.
  for (const params of [{ transactionUid: providerId }, { pageRequestUid: providerId }]) {
    try {
      const check = await fetchTransaction(params);
      if (check.paid) return check.plan;
    } catch {
      // не тот вид идентификатора или касса молчит: пробуем дальше
    }
  }
  return undefined;
}

/**
 * Спрашивает PayPlus про продажи без записанной разбивки: прошедшие до
 * того, как её начали сохранять при оплате. За раз немного, все запросы
 * идут разом: ждать приходится один таймаут кассы, а не десять.
 */
export async function askPlans(limit = 10): Promise<{ asked: number; failed: number; left: number }> {
  const rows = await unasked();
  const done = await Promise.all(rows.slice(0, limit).map(async (r) => {
    const plan = await askOne(r.provider_id);
    if (plan === undefined) return false;
    const table = r.source === 'studio' ? 'payments' : 'course_orders';
    // Ответ без разбивки тоже записываем пустым: спрошено, PayPlus не знает,
    // и спрашивать заново незачем.
    await query(
      `update ${table}
          set raw = (case when jsonb_typeof(raw) = 'object' then raw else '{}'::jsonb end)
                    || jsonb_build_object('plan', $2::jsonb)
        where id = $1`,
      [r.id, JSON.stringify(plan ?? {})],
    );
    return true;
  }));

  const asked = done.filter(Boolean).length;
  return { asked, failed: done.length - asked, left: rows.length - asked };
}
