import Script from 'next/script';
import Payouts from './Payouts';

export const dynamic = 'force-dynamic';

/**
 * Мини-приложение с графиком выплат Isracard. Страница пустая: числа
 * забирает Payouts у /api/tg/payouts, предъявляя подпись телеграма.
 */
export default function TgPayoutsPage() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <Payouts />
    </>
  );
}
