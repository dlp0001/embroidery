import {
  answerCallback, applyTap, bindChat, chatUser, editMessage, eventViews, isTeacher, readTap,
  secretOk, send, teacherDayView, viewAfterTap, weekView,
} from '@/lib/telegram';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Телеграм зовёт этот адрес на каждое сообщение боту и на каждое нажатие
 * кнопки под сообщением.
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
  callback_query?: {
    id?: string;
    data?: string;
    message?: { message_id?: number; chat?: { id?: number } };
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

async function onMessage(chatId: number, text: string, origin: string): Promise<void> {
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
    const teaches = await isTeacher(bound.userId);
    await send(chatId, [
      `${hello} Теперь я вас узнаю.`,
      '',
      teaches
        ? 'Напишите что угодно — покажу, кто записан на сегодня.'
        : 'Напишите что угодно — покажу ближайшую неделю с кнопками записи.',
    ].join('\n'));
    return;
  }

  const user = await chatUser(chatId);
  if (!user) {
    await send(chatId, stranger(origin));
    return;
  }

  // Команд пока нет: любое сообщение — просьба показать, что впереди.
  // Разбирать слова начнём тогда, когда боту будет что ещё ответить.
  const teaches = await isTeacher(user.id);
  if (teaches) {
    const day = await teacherDayView(user.id, user.name);
    await send(chatId, day.text);
  }

  // Родительскую неделю преподавателю показываем только если она не
  // пустая: у Вари своей семьи в студии нет, и «занятий нет» сразу после
  // журнала выглядит поломкой, а не ответом.
  const week = await weekView(user.id, origin);
  if (!teaches || !week.empty) await send(chatId, week.text, week.keyboard);

  // Смена — отдельным сообщением, и только пока она есть: кончится лагерь,
  // кончатся и эти сообщения, ничего выключать не придётся.
  for (const view of await eventViews(user.id, origin)) {
    await send(chatId, view.text, view.keyboard);
  }
}

/**
 * Нажатие на кнопку под сообщением. Отвечать телеграму нужно обязательно
 * и быстро: пока ответа нет, кнопка у родителя крутится.
 */
async function onTap(
  id: string, chatId: number, messageId: number, data: string, origin: string,
): Promise<void> {
  const user = await chatUser(chatId);
  if (!user) {
    await answerCallback(id, 'Сначала подключите телеграм в профиле.');
    return;
  }

  const tap = readTap(data);
  if (!tap) {
    await answerCallback(id, 'Кнопка устарела, попросите неделю заново.');
    return;
  }

  const said = await applyTap(user.id, tap);
  await answerCallback(id, said);

  // Перерисовываем всё сообщение: изменилась не одна кнопка, а и число
  // свободных мест, которое видят все строки этого дня. Какое именно
  // сообщение — решает занятие: у смены оно своё.
  const view = await viewAfterTap(user.id, tap, origin);
  await editMessage(chatId, messageId, view.text, view.keyboard);
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

  const origin = new URL(req.url).origin;
  const tap = update.callback_query;
  const chatId = update.message?.chat?.id ?? tap?.message?.chat?.id;

  try {
    if (tap?.id && chatId && tap.message?.message_id) {
      await onTap(tap.id, chatId, tap.message.message_id, tap.data ?? '', origin);
    } else if (chatId) {
      const text = (update.message?.text ?? '').trim();
      // Апдейты бывают всякие: вступление в чат, правка сообщения, стикер.
      // Всё, что не текст в личке, нас пока не касается.
      if (text) await onMessage(chatId, text, origin);
    }
  } catch (err) {
    console.error('telegram: апдейт не обработан', err);
    if (tap?.id) await answerCallback(tap.id, 'Что-то сломалось. Попробуйте позже.');
    else if (chatId) await send(chatId, 'Что-то сломалось на нашей стороне. Попробуйте позже.');
  }
  return Response.json({ ok: true });
}
