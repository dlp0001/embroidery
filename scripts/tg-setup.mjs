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
    // Сообщения и нажатия на кнопки под ними. Больше боту ничего не нужно,
    // а лишнее телеграм присылать не будет.
    allowed_updates: ['message', 'callback_query'],
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
// Список телеграм хранит у себя. Нет тут callback_query — кнопки под
// сообщениями будут нажиматься впустую, и никакой ошибки при этом нет.
console.log(`  апдейты          ${(info.allowed_updates ?? ['все']).join(', ')}`);
console.log(`  в очереди        ${info.pending_update_count ?? 0}`);
if (info.last_error_message) {
  console.log(`  последняя ошибка ${info.last_error_message}`);
}
