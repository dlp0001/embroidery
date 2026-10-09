import { query } from './db';
import { PAY_BUCKET, type PayKind } from './stats';

/**
 * Квитанции: что выписано, что нет и по каким деньгам.
 *
 * Считаем по платежам, а не по занятиям: квитанция выписывается на
 * платёж целиком, даже когда он закрыл три занятия сразу. Поэтому и
 * суммы здесь кассовые — по дню платежа, не по дню занятия.
 */

/** Квитанция есть: либо ссылка на неё, либо пометка «iCount уже выписал». */
const BILLED = `(p.invoice_url is not null or p.raw ? 'receipt')`;

/** Настоящие деньги: подарок нулевой, проверочный платёж не касса. */
const MONEY = `p.status = 'paid'
               and p.provider <> 'gift'
               and p.purpose is distinct from 'studio_test'`;

export type Cell = { count: number; sum: number };

/** Строка отчёта: способ оплаты и что с бумагами по нему. */
export type TallyRow = {
  kind: Exclude<PayKind, 'due'>;
  label: string;
  billed: Cell;
  left: Cell;
};

/**
 * Подписи и порядок. Карта первой: по ней квитанция выписывается всегда
 * и сама, и строка нужна как опора — если в ней вдруг есть невыписанные,
 * что-то сломалось. «Способ не записан» — старые платежи, принятые до
 * того, как журнал стал спрашивать способ.
 */
const KINDS: { kind: TallyRow['kind']; label: string }[] = [
  { kind: 'card', label: 'Картой' },
  { kind: 'cash', label: 'Наличными' },
  { kind: 'transfer', label: 'Переводом' },
  { kind: 'unknown', label: 'Способ не записан' },
];

export async function receiptTally(from: string, to: string): Promise<TallyRow[]> {
  const rows = await query<{
    kind: string; billed_n: number; billed_sum: string; left_n: number; left_sum: string;
  }>(
    `select ${PAY_BUCKET('p')} as kind,
            count(*) filter (where ${BILLED})::int as billed_n,
            coalesce(sum(p.amount) filter (where ${BILLED}), 0)::text as billed_sum,
            count(*) filter (where not ${BILLED})::int as left_n,
            coalesce(sum(p.amount) filter (where not ${BILLED}), 0)::text as left_sum
       from payments p
      where ${MONEY}
        and p.created_at >= $1::date and p.created_at < ($2::date + 1)
      group by 1`,
    [from, to],
  );

  const cell = (n: number | undefined, sum: string | undefined): Cell =>
    ({ count: n ?? 0, sum: Number(sum ?? 0) });

  return KINDS
    .map(({ kind, label }) => {
      const r = rows.find((x) => x.kind === kind);
      return { kind, label, billed: cell(r?.billed_n, r?.billed_sum), left: cell(r?.left_n, r?.left_sum) };
    })
    // Пустую строку про неизвестный способ не показываем: она про старые
    // деньги и должна исчезнуть сама, когда таких не останется.
    .filter((r) => r.kind !== 'unknown' || r.billed.count + r.left.count > 0);
}

export type Unbilled = {
  id: string;
  at: string;
  amount: string;
  currency: string;
  provider: string;
  pay_method: string | null;
  purpose: string | null;
  /** Кому выписывать: плательщик, он же владелец начислений. */
  owner_id: string | null;
  who: string;
  /** Что закрыто этим платежом: дни и имена, одной строкой. */
  items: string | null;
  lessons: number;
  group_title: string | null;
  extra_days: number;
  /** Варя отметила «чек не нужен»: бумагу просили не выписывать. */
  declined: boolean;
};

/**
 * Полученные деньги без квитанции. Сюда попадает и то, по чему чек не
 * просили: страница для того и есть, чтобы выписать забытое, а решение
 * принимает человек — поэтому «чек не нужен» показываем пометкой, а не
 * прячем строку.
 */
export async function unbilledPayments(from: string, to: string): Promise<Unbilled[]> {
  return query<Unbilled>(
    `select p.id, p.created_at::text as at, p.amount::text, p.currency, p.provider,
            p.raw ->> 'pay_method' as pay_method, p.purpose, p.user_id as owner_id,
            coalesce(u.name, u.email, 'без плательщика') as who,
            coalesce(p.raw ->> 'receipt_wanted' = 'no', false) as declined,
            case when p.raw ? 'extends_pass'
                 then coalesce((p.raw ->> 'days')::int, 0) else 0 end as extra_days,
            (select g.title from passes ps
               join studio_groups g on g.id = ps.group_id
              where ps.payment_id = p.id) as group_title,
            coalesce(
              jsonb_array_length(p.raw -> 'charge_ids'),
              nullif((select count(*)::int from charges ch where ch.payment_id = p.id), 0),
              (select ps.lessons_total from passes ps where ps.payment_id = p.id),
              0) as lessons,
            (select string_agg(x.line, ', ' order by x.held_on)
               from (select distinct s.held_on,
                            to_char(s.held_on, 'DD.MM') || ' '
                              || coalesce(kid.name, ku.name, '?') as line
                       from charges ch
                       join studio_sessions s on s.id = ch.session_id
                       left join participants pt on pt.id = ch.participant_id
                       left join children kid on kid.id = pt.child_id
                       left join users ku on ku.id = pt.user_id
                      where ch.payment_id = p.id) x) as items
       from payments p
       left join users u on u.id = p.user_id
      where ${MONEY} and not ${BILLED}
        and p.created_at >= $1::date and p.created_at < ($2::date + 1)
      order by u.name nulls last, p.created_at`,
    [from, to],
  );
}
