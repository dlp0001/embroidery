/**
 * Письмо тем, кто ходит по вторникам, но на сегодня не записался.
 * Повод разовый: к утру из девяти мест заняты пять.
 *
 * Цифры проставлены руками и верны на утро 6 октября. Если письмо уходит
 * позже и мест стало меньше, цифры надо поправить: расхождение с тем, что
 * человек увидит в кабинете, дороже лишней сверки.
 *
 * Длинных тире в тексте нет: так просила Варя.
 */

export const campaign = 'seats-2026-10-06';

export const subject = 'Занятие в студии у Вари: сегодня в 15:00, четыре места';

/** Строка, которую почтовик показывает рядом с темой. */
const preheader =
  'Пятеро уже записались. Если придёте, отметьтесь в кабинете, чтобы вас ждали.';

/** Рассылка подставит личную ссылку привязки каждому получателю. */
export const needsBotLink = true;

export function hello(name) {
  const who = (name ?? '').trim().split(/\s+/)[0];
  return who ? `Здравствуйте, ${who}.` : 'Здравствуйте.';
}

export function text({ name, botUrl, unsubscribeUrl }) {
  return `${hello(name)}

Сегодня вторник, занятие в 15:00. Этим утром из девяти мест свободны четыре:
пятеро уже записались.

Если придёте, отметьтесь в кабинете. Варя будет знать, кого ждать, и
приготовит материалы заранее:
https://www.re-create.art/account

Если сегодня не получается, делать ничего не нужно.

И про бота, заодно. В телеграме он показывает ближайшие занятия, спрашивает
накануне, кто придёт, и записывает в одно нажатие, без захода на сайт.
Ссылка личная, живёт две недели:
${botUrl}

Варя

Отказаться от писем: ${unsubscribeUrl}`;
}

export function html({ name, botUrl, unsubscribeUrl }) {
  const p = 'margin:0 0 18px;font-size:16px;line-height:1.75;color:#1a1a2e';

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
    Сегодня вторник, занятие в <strong>15:00</strong>. Этим утром из девяти
    мест свободны четыре: пятеро уже записались.
  </p>

  <p style="${p}">
    Если придёте, отметьтесь в кабинете. Варя будет знать, кого ждать, и
    приготовит материалы заранее.
  </p>

  <p style="margin:0 0 28px">
    <a href="https://www.re-create.art/account"
       style="display:inline-block;padding:14px 28px;background:#e91e8c;color:#fff;
              font-size:13px;letter-spacing:.15em;text-transform:uppercase;
              text-decoration:none">Отметиться в кабинете</a>
  </p>

  <p style="${p}">Если сегодня не получается, делать ничего не нужно.</p>

  <p style="margin:0 0 10px;font-size:15px;line-height:1.7;color:#333">
    И про бота, заодно. В телеграме он показывает ближайшие занятия,
    спрашивает накануне, кто придёт, и записывает в одно нажатие, без
    захода на сайт.
  </p>
  <p style="margin:0 0 28px;font-size:15px;line-height:1.7">
    <a href="${botUrl}" style="color:#e91e8c">Подключить бота</a>
    <span style="color:#666">· ссылка личная и живёт две недели</span>
  </p>

  <p style="${p}">Варя</p>

  <p style="margin:32px 0 0;font-size:12px;line-height:1.6;color:#999">
    <a href="${unsubscribeUrl}" style="color:#999">Отказаться от писем</a>
  </p>

</div></body></html>`;
}
