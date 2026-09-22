// Регистрация вебхука телеграма. Гонять после первого деплоя бота и после
// каждой смены секрета — телеграм хранит адрес и секрет у себя.
//
//   npm run tg:setup      -- https://превью.vercel.app
//   npm run tg:setup:prod -- https://re-create.art
//
// Без аргумента показывает, что телеграм думает про вебхук сейчас.

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token) { console.error('TELEGRAM_BOT_TOKEN не задан'); process.exit(1); }

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`${method}: ${data.description ?? res.status}`);
    process.exit(1);
  }
  return data.result;
};

const me = await api('getMe');
console.log(`Бот: @${me.username} (${me.first_name})`);

const origin = process.argv.slice(2).find((a) => !a.startsWith('--'));
const drop = process.argv.includes('--drop');

if (origin) {
  if (!secret) { console.error('TELEGRAM_WEBHOOK_SECRET не задан: без него вебхук открыт всем'); process.exit(1); }
  const url = `${origin.replace(/\/+$/, '')}/api/telegram`;

  // Телеграм не ходит по редиректам: адрес, отвечающий 307, он считает
  // сломанным вебхуком и молча копит очередь. Это уже случалось дважды —
  // у сайта канонический домен с www, а по привычке пишут без него.
  // Здоровый адрес отвечает 401: роут на месте и просит секрет.
  const probe = await fetch(url, { method: 'POST', redirect: 'manual' })
    .catch((err) => ({ status: 0, why: err.message }));
  if (probe.status >= 300 && probe.status < 400) {
    console.error(`${url} отвечает ${probe.status} и уводит на ${probe.headers?.get('location') ?? '?'}`);
    console.error('Телеграм по редиректам не ходит. Возьмите адрес, на который уводит.');
    process.exit(1);
  }
  if (probe.status === 404) {
    console.error(`${url} отвечает 404: на этом деплое роута бота нет. Сначала выкатите код.`);
    process.exit(1);
  }

  await api('setWebhook', {
    url,
    secret_token: secret,
    // Сообщения и нажатия на кнопки под ними. Больше боту ничего не нужно,
    // а лишнее телеграм присылать не будет.
    allowed_updates: ['message', 'callback_query'],
    // Накопившееся выбрасываем только по просьбе. По умолчанию — нет:
    // очередь копится как раз тогда, когда вебхук сломан, и там лежат
    // живые сообщения родителей, а не мусор.
    drop_pending_updates: drop,
  });
  console.log(`Вебхук: ${url}${drop ? ' (очередь очищена)' : ''}`);
}

const info = await api('getWebhookInfo');
console.log('\nСейчас у телеграма:');
console.log(`  адрес            ${info.url || 'не задан'}`);
console.log(`  секрет           ${info.has_custom_certificate ? 'свой сертификат' : secret ? 'задан' : 'НЕТ'}`);
// Список телеграм хранит у себя. Нет тут callback_query — кнопки под
// сообщениями будут нажиматься впустую, и никакой ошибки при этом нет.
console.log(`  апдейты          ${(info.allowed_updates ?? ['все']).join(', ')}`);
console.log(`  в очереди        ${info.pending_update_count ?? 0}`);
if (info.last_error_message) {
  console.log(`  последняя ошибка ${info.last_error_message}`);
}
