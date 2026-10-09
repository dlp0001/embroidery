// Подписанный вызов вебхука Polar на локальный сайт — проверить курс без
// настоящей покупки. Сайт поднять конфигурацией site-polar-test: у неё
// секрет local-test-secret.
//
//   node scripts/polar-webhook-test.mjs <checkout-id|-> <email> [--bad-signature] [--order=<id>]
//
// --order — тот же id заказа ещё раз: так проверяется, что повторный
// вебхук не продлевает доступ и не шлёт второе письмо.
//
// checkout-id — строка из course_checkouts (provider = polar); «-» — без
// неё, тогда курс узнаётся по metadata.course, а почта берётся из заказа.

import { createHmac, randomUUID } from 'node:crypto';

const [checkout, email = 'polar-test@example.com'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const bad = process.argv.includes('--bad-signature');
const orderId = process.argv.find((a) => a.startsWith('--order='))?.slice(8) ?? `test-${randomUUID()}`;
const secret = 'local-test-secret';
const url = 'http://localhost:4321/api/webhook-polar';

const body = JSON.stringify({
  type: 'order.paid',
  data: {
    id: orderId,
    status: 'paid',
    paid: true,
    currency: 'usd',
    total_amount: 8000,
    metadata: { course: 'embroidery', ...(checkout && checkout !== '-' ? { checkout } : {}) },
    customer: { email, name: 'Тест Polar' },
  },
});

const id = `msg_${randomUUID()}`;
const ts = String(Math.floor(Date.now() / 1000));
const sig = createHmac('sha256', Buffer.from(bad ? 'wrong' : secret, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64');

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
  body,
});
console.log(res.status, await res.text());
