import { bindChat, chatUser, secretOk, send, weekText } from '@/lib/telegram';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Телеграм зовёт этот адрес на каждое сообщение боту.
 *
 * Отвечаем 200 всегда, что бы внутри ни случилось: на ошибку телеграм
 * повторяет тот же апдейт с нарастающей паузой и может долбить им час.
 * Исключение одно — не сошёлся секрет: такому вызову отвечать нечего.
 */
type Update = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

/** Что написать тому, кого мы не знаем. */
function stranger(origin: string): string {
  return [
    'Не знаю, кто вы.',
    '',
    `Откройте профиль на сайте и нажмите «Подключить телеграм»: ${origin}/account/profile`,
    '',
    'Так бот поймёт, чьи дети и какие занятия показывать.',
  ].join('\n');
}

async function handle(chatId: number, text: string, origin: string): Promise<void> {
  const start = /^\/start(?:\s+(\S+))?$/.exec(text);

  if (start?.[1]) {
    const bound = await bindChat(start[1], chatId);
    if (!bound.ok) {
      await send(chatId, [
        'Ссылка не подошла.',
        '',
        'Она одноразовая и живёт пятнадцать минут. Откройте профиль и нажмите кнопку ещё раз:',
        `${origin}/account/profile`,
      ].join('\n'));
      return;
    }
    const hello = bound.name ? `Здравствуйте, ${bound.name}!` : 'Здравствуйте!';
    await send(chatId, [
      `${hello} Теперь я вас узнаю.`,
      '',
      'Напишите что угодно — покажу ближайшую неделю.',
    ].join('\n'));
    return;
  }

  const user = await chatUser(chatId);
  if (!user) {
    await send(chatId, stranger(origin));
    return;
  }

  // Команд пока нет: любое сообщение — просьба показать неделю. Разбирать
  // слова начнём тогда, когда боту будет что ещё ответить.
  await send(chatId, await weekText(user.id, origin));
}

export async function POST(req: Request): Promise<Response> {
  if (!secretOk(req.headers.get('x-telegram-bot-api-secret-token'))) {
    console.error('telegram: вызов с чужим секретом');
    return Response.json({ error: 'forbidden' }, { status: 401 });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return Response.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? '').trim();
  // Апдейты бывают всякие: вступление в чат, правка сообщения, стикер.
  // Всё, что не текст в личке, нас пока не касается.
  if (!chatId || !text) return Response.json({ ok: true });

  try {
    await handle(chatId, text, new URL(req.url).origin);
  } catch (err) {
    console.error('telegram: апдейт не обработан', err);
    await send(chatId, 'Что-то сломалось на нашей стороне. Мы уже знаем, попробуйте позже.');
  }
  return Response.json({ ok: true });
}
