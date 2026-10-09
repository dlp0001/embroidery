import { one, query } from './db';

/**
 * Покупатели курса глазами Вари. Отдельно от студии: здесь только
 * course_* таблицы, люди студии сюда не попадают.
 */

export type Buyer = {
  id: string;
  email: string;
  name: string | null;
  source: 'purchase' | 'manual' | 'legacy';
  since: string;
  until: string;
  expired: boolean;
  revoked: boolean;
  devices: number;
  link_sent: string | null;
  /** Последняя оплата: касса, сумма, валюта. */
  provider: string | null;
  amount: string | null;
  currency: string | null;
  receipt_url: string | null;
  receipt_error: string | null;
  /** id оплаты у PayPlus — чтобы добить квитанцию. */
  payplus_id: string | null;
};

export async function buyers(slug: string): Promise<Buyer[]> {
  return query<Buyer>(
    `select a.id, a.email, a.name, a.source,
            a.created_at::date::text as since,
            a.expires_at::date::text as until,
            a.expires_at <= now() as expired,
            a.revoked_at is not null as revoked,
            (select count(*)::int from course_devices d
              where d.access_id = a.id and d.revoked_at is null) as devices,
            a.link_sent_at::date::text as link_sent,
            o.provider, o.amount::text, o.currency, o.receipt_url, o.receipt_error,
            case when o.provider = 'payplus' then o.provider_id end as payplus_id
       from course_access a
       join courses c on c.id = a.course_id
       left join lateral (
         select * from course_orders o where o.access_id = a.id
          order by o.created_at desc limit 1
       ) o on true
      where c.slug = $1
      order by a.created_at desc`,
    [slug],
  );
}

export type Abandoned = {
  email: string;
  name: string | null;
  provider: string;
  amount: string;
  currency: string;
  at: string;
};

/**
 * Дошли до кассы и не заплатили — за последние 30 дней. Тех, кто потом
 * всё-таки купил, не показываем.
 */
export async function abandoned(slug: string): Promise<Abandoned[]> {
  return query<Abandoned>(
    `select distinct on (k.email) k.email, k.name, k.provider, k.amount::text, k.currency,
            to_char(k.created_at, 'DD.MM HH24:MI') as at
       from course_checkouts k
       join courses c on c.id = k.course_id
      where c.slug = $1 and k.paid_at is null
        and k.created_at > now() - interval '30 days'
        and not exists (select 1 from course_access a
                         where a.course_id = k.course_id and a.email = k.email
                           and a.created_at >= k.created_at)
      order by k.email, k.created_at desc`,
    [slug],
  );
}

export async function resetDevices(accessId: string): Promise<void> {
  await query(
    'update course_devices set revoked_at = now() where access_id = $1 and revoked_at is null',
    [accessId],
  );
}

/** Отозвать: ссылка перестаёт работать, все браузеры теряют доступ. */
export async function revoke(accessId: string): Promise<void> {
  await query(
    'update course_access set revoked_at = now(), link_hash = null where id = $1',
    [accessId],
  );
  await resetDevices(accessId);
}

export async function restore(accessId: string): Promise<void> {
  await query('update course_access set revoked_at = null where id = $1', [accessId]);
}

/** Карта из сохранённой проверки PayPlus: нужна, чтобы добить квитанцию. */
export async function payplusCard(providerId: string) {
  const row = await one<{ card: unknown }>(
    `select raw -> 'card' as card from course_orders where provider = 'payplus' and provider_id = $1`,
    [providerId],
  );
  return (row?.card ?? null) as import('./icount').Card | null;
}
