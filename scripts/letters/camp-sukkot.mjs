/**
 * Письмо про лагерь на Суккот: 22 сентября — 2 октября 2026.
 *
 * Одно письмо — один файл. Цифры здесь проставлены руками и должны
 * совпадать с тем, что стоит в базе и показано на /camp: письмо уходит
 * людям, и расхождение в цене или времени дороже, чем лишняя сверка.
 *
 * В самом тексте длинных тире нет: так просила Варя. Если правите письмо,
 * держите это в голове и разбивайте фразу на две вместо тире.
 */

export const campaign = 'camp-sukkot-2026';

export const subject = 'Кейтана на Суккот: с 22 сентября по 2 октября';

/** Строка, которую почтовик показывает рядом с темой. */
const preheader =
  'Десять дней с 9 до 14. Еда входит в цену. Восемь человек в день.';

/** Обращение: имени может не быть, тогда письмо начинается без него. */
function hello(name) {
  const who = (name ?? '').trim().split(/\s+/)[0];
  return who ? `Здравствуйте, ${who}.` : 'Здравствуйте.';
}

export function text({ name, unsubscribeUrl }) {
  return `${hello(name)}

Со вторника в студии начинается кейтана, лагерь на Суккот. С 22 сентября
по 2 октября, каждый день с 09:00 до 14:00, кроме субботы. Всего десять дней.

Это занятие на пять часов. Будем творить и делать невероятные штуки:
живопись, графика, картон, ткань, глина, объём. Всё сразу и в любом порядке,
без шаблонов и образцов.

А ещё это лагерь лайфхаков. Будем чинить, шить, печь и готовить, разбирать
и собирать: полезные бытовые вещи в самом креативном формате, на какой
хватит выдумки.

Приходить на все дни не обязательно. В кабинете отмечаете те, которые нужны;
если передумали, снимаете отметку.

Коротко
· Еда входит в цену. Кормим всё это время: паста, овощи, фрукты, снэки.
  Контейнеры собирать не нужно. В какие-то дни будем готовить сами, это
  тоже занятие.
· Материалы и инструменты студийные. Приносить ничего не надо, кроме того,
  что захочется: скетчбук, вещь, которую давно хочется раскрасить, печенье,
  картонную коробку от холодильника.
· Восемь человек в день. Количество мест ограничено, поэтому просим
  записываться заранее.
· Обычные занятия идут как шли. Расписание студии на эти дни не меняется:
  можно прийти на лагерь утром и на своё занятие потом.

Сколько стоит
· Один день: 330 ₪. Платится за тот день, в который ребёнок пришёл.
· Пакет на 5 дней: 1550 ₪, по 310 ₪ за день.
· Пакет на 6 дней: 1800 ₪, по 300 ₪ за день.
· Пакет на 7 дней: 2000 ₪, по 286 ₪ за день.
Дни из пакета тратятся только на лагерь и сгорают 2 октября. Обычный
абонемент студии в лагере не работает, и наоборот.

Записаться: https://re-create.art/camp. Там все дни смены и кнопка на каждый.
Пароль не нужен: вводите этот адрес почты и код, который придёт письмом.

Студия на Старом Севере Тель-Авива, улица Shimon HaTarsi. Вопросы задавайте
ответом на это письмо или пишите на info@re-create.art.

Варя

Это письмо пришло вам как родителю ребёнка, который ходит в студию.
Отказаться от таких писем: ${unsubscribeUrl}
`;
}

export function html({ name, unsubscribeUrl }) {
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
    Со вторника в студии начинается <strong>кейтана</strong>, лагерь на Суккот.
    С 22 сентября по 2 октября, каждый день с 09:00 до 14:00, кроме субботы.
    Всего десять дней.
  </p>

  <p style="${p}">
    Это занятие на пять часов. Будем творить и делать невероятные штуки:
    живопись, графика, картон, ткань, глина, объём. Всё сразу и в любом
    порядке, без шаблонов и образцов.
  </p>

  <p style="${p}">
    А ещё это <strong>лагерь лайфхаков</strong>. Будем чинить, шить, печь
    и готовить, разбирать и собирать: полезные бытовые вещи в самом креативном
    формате, на какой хватит выдумки.
  </p>

  <p style="${p}">
    Приходить на все дни не обязательно. В кабинете отмечаете те, которые
    нужны; если передумали, снимаете отметку.
  </p>

  <h2 style="${h2}">Коротко</h2>
  <ul style="margin:0 0 18px;padding-left:20px">
    <li style="${li}">
      <strong>Еда входит в цену.</strong> Кормим всё это время: паста, овощи,
      фрукты, снэки. Контейнеры собирать не нужно. В какие-то дни будем
      готовить сами, это тоже занятие.
    </li>
    <li style="${li}">
      <strong>Материалы студийные.</strong> Приносить ничего не надо, кроме
      того, что захочется: скетчбук, вещь, которую давно хочется раскрасить,
      печенье, картонную коробку от холодильника.
    </li>
    <li style="${li}">
      <strong>Восемь человек в день.</strong> Количество мест ограничено,
      поэтому просим записываться заранее.
    </li>
    <li style="${li}">
      <strong>Обычные занятия идут как шли.</strong> Расписание студии на эти
      дни не меняется: можно прийти на лагерь утром и на своё занятие потом.
    </li>
  </ul>

  <h2 style="${h2}">Сколько стоит</h2>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 14px">
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#333">Один день</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#1a1a2e;text-align:right;white-space:nowrap">330 ₪</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#333">Пакет на 5 дней <span style="color:#888">· 310 ₪ за день</span></td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#1a1a2e;text-align:right;white-space:nowrap">1550 ₪</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#333">Пакет на 6 дней <span style="color:#888">· 300 ₪ за день</span></td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#1a1a2e;text-align:right;white-space:nowrap">1800 ₪</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#333">Пакет на 7 дней <span style="color:#888">· 286 ₪ за день</span></td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:15px;color:#1a1a2e;text-align:right;white-space:nowrap">2000 ₪</td></tr>
  </table>
  <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#666">
    Один день платится за тот день, в который ребёнок пришёл. Дни из пакета
    тратятся только на лагерь и сгорают 2 октября: обычный абонемент студии
    в лагере не работает, и наоборот.
  </p>

  <p style="margin:0 0 28px">
    <a href="https://re-create.art/camp"
       style="display:inline-block;padding:14px 28px;background:#e91e8c;color:#fff;
              font-size:13px;letter-spacing:.15em;text-transform:uppercase;
              text-decoration:none">Посмотреть дни и записаться</a>
  </p>

  <p style="${p}">
    На странице лагеря все дни смены и кнопка на каждый. Пароль не нужен:
    вводите этот адрес почты и код, который придёт письмом.
  </p>

  <p style="margin:0 0 6px;font-size:14px;line-height:1.7;color:#666">
    Студия на Старом Севере Тель-Авива, улица Shimon HaTarsi.<br>
    Вопросы задавайте ответом на это письмо или пишите на
    <a href="mailto:info@re-create.art" style="color:#e91e8c">info@re-create.art</a>.
  </p>
  <p style="margin:24px 0 0;font-size:16px;color:#1a1a2e">Варя</p>

  <p style="margin:40px 0 0;padding-top:20px;border-top:1px solid #eee;
            font-size:12px;line-height:1.7;color:#999">
    Это письмо пришло вам как родителю ребёнка, который ходит в студию.
    <a href="${unsubscribeUrl}" style="color:#999">Отказаться от таких писем</a>.
  </p>

</div>
</body></html>`;
}
