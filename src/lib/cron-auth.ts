import { timingSafeEqual } from 'node:crypto';

/**
 * Два ключа с разными правами.
 *
 * `tick` умеет только одно: спросить «что пора отправить». Всё, что он
 * может натворить, — пустые вызовы: время проверяется окнами, а повтор
 * гасится отметкой в tg_log. Такой ключ не страшно отдать внешнему
 * сервису-пингеру, который дёргает адрес каждые четверть часа.
 *
 * `force` отправляет немедленно и мимо окон, то есть умеет спамить. Он
 * остаётся у нас и живёт в отдельной переменной. Не задана — принудительной
 * отправки нет вовсе: лучше её лишиться, чем раздать вместе с пингером.
 */
export type CronRights = 'none' | 'tick' | 'force';

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function cronRights(req: Request): CronRights {
  const given = req.headers.get('authorization') ?? '';
  const force = process.env.CRON_FORCE_SECRET;
  const tick = process.env.CRON_SECRET;
  // Сильный ключ проверяем первым: он годится и для обычного тика.
  if (force && same(given, `Bearer ${force}`)) return 'force';
  if (tick && same(given, `Bearer ${tick}`)) return 'tick';

  // Запасной путь для пингеров, которые не умеют свои заголовки: слабый
  // ключ принимается и в адресе. Ключ в адресе попадает в логи, и обычно
  // так делать нельзя — но этим ключом навредить и нельзя: он умеет
  // только спросить «что пора», а окна и tg_log гасят любой лишний вызов.
  // Сильный ключ так не принимаем никогда.
  const inUrl = new URL(req.url).searchParams.get('key');
  if (tick && inUrl && same(inUrl, tick)) return 'tick';
  return 'none';
}

/**
 * Что за ключ приехал — для ответа на отказ. Значение не показываем, только
 * способ и длину: без этого внешний сервис отвечает глухим 401, и понять,
 * заголовок ли не дошёл или секрет не тот, нельзя.
 */
export function describeAuth(req: Request): string {
  const given = req.headers.get('authorization');
  const inUrl = new URL(req.url).searchParams.get('key');
  if (!given && !inUrl) return 'ни заголовка Authorization, ни key в адресе';
  if (!given) return `key в адресе, ${inUrl!.length} знаков`;
  const [scheme, ...rest] = given.split(' ');
  const value = rest.join(' ');
  if (!value) return `заголовок есть, но в нём одно слово (${given.length} знаков), а нужно «Bearer ключ»`;
  return `заголовок «${scheme} …», ключ ${value.length} знаков`;
}
