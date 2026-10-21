import Script from 'next/script';
import Stats from './Stats';

export const dynamic = 'force-dynamic';

/**
 * Мини-приложение телеграма со статистикой студии. Сама страница пустая:
 * числа забирает Stats у /api/tg/stats, предъявляя подпись телеграма.
 * Открыть её по ссылке в браузере можно, увидеть что-то — нет.
 *
 * Скрипт телеграма обязан загрузиться до нашего кода: из него берётся
 * initData. beforeInteractive как раз про это.
 */
export default function TgStatsPage() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <Stats />
    </>
  );
}
