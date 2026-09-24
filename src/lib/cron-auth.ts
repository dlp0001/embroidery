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
  return 'none';
}
