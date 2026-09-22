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

const origin = process.argv[2];
if (origin) {
  if (!secret) { console.error('TELEGRAM_WEBHOOK_SECRET не задан: без него вебхук открыт всем'); process.exit(1); }
  const url = `${origin.replace(/\/+$/, '')}/api/telegram`;
  await api('setWebhook', {
    url,
    secret_token: secret,
    // Пока бот умеет только читать сообщения. Кнопки добавятся вторым
    // этапом, тогда сюда приедет и callback_query.
    allowed_updates: ['message'],
    // Всё, что накопилось, пока вебхука не было, нам не нужно: это старые
    // сообщения, отвечать на них сутки спустя незачем.
    drop_pending_updates: true,
  });
  console.log(`Вебхук: ${url}`);
}

const info = await api('getWebhookInfo');
console.log('\nСейчас у телеграма:');
console.log(`  адрес            ${info.url || 'не задан'}`);
console.log(`  секрет           ${info.has_custom_certificate ? 'свой сертификат' : secret ? 'задан' : 'НЕТ'}`);
console.log(`  в очереди        ${info.pending_update_count ?? 0}`);
if (info.last_error_message) {
  console.log(`  последняя ошибка ${info.last_error_message}`);
}
