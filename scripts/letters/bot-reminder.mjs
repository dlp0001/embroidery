/**
 * Второе письмо про бота, октябрь 2026. Уходит только тем, у кого бот не
 * подключён: остальным оно ни о чём.
 *
 * Первое письмо (bot-invite-2026-09) рассказывало, что бот есть. Это
 * рассказывает, что он с тех пор начал писать сам: вечерний вопрос,
 * утреннее напоминание, письма про абонемент. Повторять список команд
 * целиком незачем, достаточно двух главных.
 *
 * Ссылка привязки личная и живёт две недели, поэтому needsBotLink.
 * Длинных тире в тексте нет: так просила Варя.
 */

export const campaign = 'bot-again-2026-10';

/** Кому: у кого бота нет, но кто в студии — сам ходит или водит ребёнка. */
export const audience = 'no-bot';

export const subject = 'Бот студии теперь напоминает сам';

const preheader =
  'Спросит накануне, напомнит утром и скажет, когда закончится абонемент.';

export const needsBotLink = true;

export function hello(name) {
  const who = (name ?? '').trim().split(/\s+/)[0];
  return who ? `Здравствуйте, ${who}.` : 'Здравствуйте.';
}

export function text({ name, botUrl, unsubscribeUrl }) {
  return `${hello(name)}

В сентябре мы звали вас в телеграм-бота студии. Напоминаем про него ещё
раз, потому что с тех пор он научился главному: спрашивать сам.

Подключить: ${botUrl}

Ссылка личная и живёт две недели. Она откроет бота, там нужно нажать
«Запустить». Открывайте её с того телефона, где стоит телеграм.

Что он делает сам
· Накануне вечером спрашивает, придёт ли ребёнок на занятие. Ответ в одно
  нажатие, прямо в сообщении.
· Утром в день занятия напоминает, если вы не ответили.
· Пишет, когда в абонементе закончились занятия или подходит к концу срок.
  Раньше это было видно только в кабинете.
· Пишет, если занятие отменили или перенесли.

И отвечает, когда спросите: /week покажет ближайшую неделю и свободные
места, /pay — неоплаченные занятия и остаток абонемента. А если просто
написать боту, сообщение придёт в студию, и ответ вернётся в этот же чат.

Мест на занятии девять. Мы постараемся принять всех, кто придёт, но
записанных ждём в первую очередь: по записям видно, на скольких готовить
материалы.

Записываться по-прежнему можно на сайте: https://www.re-create.art/account
Бот ничего не отменяет, это просто способ сделать то же самое быстрее.

Варя

Отказаться от таких писем: ${unsubscribeUrl}
`;
}

export function html({ name, botUrl, unsubscribeUrl }) {
  const p = 'margin:0 0 18px;font-size:16px;line-height:1.75;color:#1a1a2e';
  const li = 'margin:0 0 10px;font-size:15px;line-height:1.7;color:#333';
  const h2 =
    'margin:36px 0 14px;font-family:Georgia,serif;font-size:21px;font-weight:400;color:#1a1a2e';

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0fa">
<div style="display:none;font-size:1px;color:#f5f0fa;max-height:0;overflow:hidden">${preheader}</div>
<div style="max-width:560px;margin:0 auto;padding:40px 28px;background:#ffffff;font-family:Georgia,serif">

  <p style="font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#666;margin:0 0 32px">
    Re.Create.Art · Варя Перлина
  </p>

  <p style="${p}">${hello(name)}</p>

  <p style="${p}">
    В сентябре мы звали вас в телеграм-бота студии. Напоминаем про него ещё
    раз, потому что с тех пор он научился главному: <strong>спрашивать
    сам</strong>.
  </p>

  <p style="margin:0 0 14px">
    <a href="${botUrl}"
       style="display:inline-block;padding:14px 28px;background:#e91e8c;color:#fff;
              font-size:13px;letter-spacing:.15em;text-transform:uppercase;
              text-decoration:none">Подключить бота</a>
  </p>
  <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#666">
    Ссылка личная и живёт две недели. Она откроет бота, там нужно нажать
    «Запустить». Открывайте её с того телефона, где стоит телеграм.
  </p>

  <h2 style="${h2}">Что он делает сам</h2>
  <ul style="margin:0 0 18px;padding-left:20px">
    <li style="${li}">
      <strong>Накануне вечером спрашивает,</strong> придёт ли ребёнок на
      занятие. Ответ в одно нажатие, прямо в сообщении.
    </li>
    <li style="${li}">
      <strong>Утром в день занятия напоминает,</strong> если вы не ответили.
    </li>
    <li style="${li}">
      <strong>Пишет про абонемент:</strong> когда в нём закончились занятия
      или подходит к концу срок. Раньше это было видно только в кабинете.
    </li>
    <li style="${li}">
      <strong>Пишет, если занятие отменили</strong> или перенесли.
    </li>
  </ul>

  <p style="${p}">
    И отвечает, когда спросите: <strong>/week</strong> покажет ближайшую
    неделю и свободные места, <strong>/pay</strong> — неоплаченные занятия и
    остаток абонемента. А если просто написать боту, сообщение придёт в
    студию, и ответ вернётся в этот же чат.
  </p>

  <p style="${p}">
    Мест на занятии девять. Мы постараемся принять всех, кто придёт, но
    записанных ждём в первую очередь: по записям видно, на скольких готовить
    материалы.
  </p>

  <p style="margin:0 0 6px;font-size:14px;line-height:1.7;color:#666">
    Записываться по-прежнему можно
    <a href="https://www.re-create.art/account" style="color:#e91e8c">на сайте</a>.
    Бот ничего не отменяет, это просто способ сделать то же самое быстрее.<br>
    Вопросы задавайте ответом на это письмо или пишите на
    <a href="mailto:info@re-create.art" style="color:#e91e8c">info@re-create.art</a>.
  </p>
  <p style="margin:24px 0 0;font-size:16px;color:#1a1a2e">Варя</p>

  <p style="margin:40px 0 0;padding-top:20px;border-top:1px solid #eee;
            font-size:12px;line-height:1.7;color:#999">
    Это письмо пришло вам как человеку, который ходит в студию или водит
    туда ребёнка.
    <a href="${unsubscribeUrl}" style="color:#999">Отказаться от таких писем</a>.
  </p>

</div>
</body></html>`;
}
