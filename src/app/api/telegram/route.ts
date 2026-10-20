import { confirmCash, declineCash } from '@/lib/billing';
import {
  dropExpenseRow, kinds, pushExpense, rememberCard, saveReceipt, setKind, expenseById,
} from '@/lib/expenses';
import { isConfigured as visionReady, readReceipt } from '@/lib/vision';
import { cashConfirmed, cashDeclined, claimCard, claimOf } from '@/lib/notify';
import {
  answerCallback, applyTap, bindChat, chatUser, editMessage, eventViews, fileBytes,
  isStudioAdmin, debtorsView, isTeacher, payView, readExpenseTap, readMoneyTap, readTap,
  receiptCard, relayAnswer, relayFromParent, secretOk, send, sendAndGetId, teacherDayView,
  viewAfterTap, weekView, PAY_LETTER,
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
    /** Снимок чека. Телеграм присылает его в нескольких размерах. */
    photo?: { file_id?: string; file_size?: number; width?: number }[];
    /** Ответ на сообщение: так студия отвечает родителю. */
    reply_to_message?: { message_id?: number };
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

async function onMessage(
  chatId: number, text: string, origin: string, replyTo: number | null,
): Promise<void> {
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
        : 'Напишите, если что-то нужно сказать студии, — передам. Расписание с кнопками записи — командой /week.',
    ].join('\n'));
    return;
  }

  const user = await chatUser(chatId);
  if (!user) {
    await send(chatId, stranger(origin));
    return;
  }

  // Ответ на пересланное сообщение: возвращаем его родителю.
  if (replyTo !== null) {
    const who = await relayAnswer(chatId, replyTo, text);
    if (who) {
      await send(chatId, `Передали: ${who}.`);
      return;
    }
  }

  const teaches = await isTeacher(user.id);
  // Команда это всё, что начинается со слэша. Иначе каждая новая команда
  // уезжала бы в студию как сообщение родителя: до сих пор исключения
  // были перечислены руками, и список бы рос.
  const cmd = text.startsWith('/') ? text.split(/\s+/)[0].toLowerCase() : null;

  if (cmd === '/pay') {
    // Долги студии это вопрос админа, а не преподавателя: у Вари обе роли,
    // а суперадмину показывать его собственные начисления вместо студийных
    // бессмысленно. Родителю, само собой, свои.
    const studio = await isStudioAdmin(user.id);
    await send(chatId, studio ? await debtorsView(origin) : await payView(user.id, origin));
    return;
  }

  if (cmd === '/help' || (cmd !== null && cmd !== '/week' && cmd !== '/today')) {
    await send(chatId, help(teaches, origin));
    return;
  }

  // Преподавателю журнал на сегодня: и по команде, и на любое слово.
  if (teaches && cmd !== '/week') {
    const day = await teacherDayView(user.id, user.name);
    await send(chatId, day.text);
    return;
  }

  // Родитель пишет боту не затем, чтобы увидеть расписание: расписание он
  // и так получает вечером. Он пишет в студию — и до сих пор бот отвечал
  // ему расписанием, а сообщение выбрасывал. Теперь передаём.
  if (cmd === null) {
    const ok = await relayFromParent(user, text);
    await send(chatId, ok
      ? 'Передали в студию. Ответ придёт сюда же.\n\nРасписание — командой /week.'
      : 'Не получилось передать сообщение. Напишите на info@re-create.art.');
    return;
  }

  // Сюда доходит только /week.
  const week = await weekView(user.id, origin);
  if (!teaches || !week.empty) await send(chatId, week.text, week.keyboard, week.html);

  // Смена — отдельным сообщением, и только пока она есть: кончится лагерь,
  // кончатся и эти сообщения, ничего выключать не придётся.
  for (const view of await eventViews(user.id, origin)) {
    await send(chatId, view.text, view.keyboard, view.html);
  }
}

/**
 * Снимок чека. Берём средний размер: телеграм отдаёт несколько, и самый
 * большой — это мегабайты, которые модель читает не лучше, а дольше.
 */
function pickPhoto(sizes: { file_id?: string; file_size?: number }[]): string | null {
  const fit = sizes.filter((p) => p.file_id && (p.file_size ?? 0) <= 1_200_000);
  const best = (fit.length ? fit : sizes).at(-1);
  return best?.file_id ?? null;
}

/**
 * Чек от Вари: сохраняем снимок, читаем поля и спрашиваем статью затрат.
 *
 * Фотографии принимаем только у тех, кто ведёт деньги студии. Родителю
 * бот картинки не обещал, и молча заводить расход от чужого снимка —
 * последнее, чего хочется в бухгалтерии.
 */
async function onPhoto(
  chatId: number, sizes: { file_id?: string; file_size?: number }[], origin: string,
): Promise<void> {
  const user = await chatUser(chatId);
  if (!user) {
    await send(chatId, stranger(origin));
    return;
  }
  if (!(await isStudioAdmin(user.id))) {
    await send(chatId, 'Картинки я пока не понимаю. Напишите словами — передам в студию.');
    return;
  }

  const fileId = pickPhoto(sizes);
  const photo = fileId ? await fileBytes(fileId) : null;
  if (!photo) {
    await send(chatId, 'Не получилось забрать снимок у телеграма. Пришлите ещё раз.');
    return;
  }

  if (!visionReady()) {
    await send(chatId, 'Распознавание не подключено: нет ключа к модели.');
    return;
  }

  const read = await readReceipt(photo);
  const id = await saveReceipt({
    photo,
    photoType: 'image/jpeg',
    userId: user.id,
    chatId,
    scan: read.ok ? read.data : null,
    error: read.ok ? null : read.error,
  });

  if (!read.ok) {
    await send(chatId, [
      'Снимок сохранил, но прочитать не смог.',
      '',
      read.error,
      '',
      `Поля можно заполнить руками: ${origin}/admin/studio/costs`,
    ].join('\n'));
    return;
  }

  const card = receiptCard(id, { ...read.data, doc_type: read.data.doc_type }, await kinds());
  const messageId = await sendAndGetId(chatId, card.text, card.keyboard, card.html);
  if (messageId) await rememberCard(id, messageId);
}

/** Что бот умеет. Разное у родителя и у преподавателя. */
function help(teaches: boolean, origin: string): string {
  return teaches
    ? [
      'Что я умею',
      '',
      '/today — кто записан на сегодня.',
      '/pay — кто сколько должен студии.',
      '/week — ваша неделя как родителя.',
      '/help — это сообщение.',
      '',
      `Журнал и финансы: ${origin}/admin/studio`,
    ].join('\n')
    : [
      'Что я умею',
      '',
      'Напишите мне что угодно, и я передам это в студию. Ответ придёт',
      'в этот же чат.',
      '',
      '/week — ближайшая неделя. Записаться и отменить можно прямо там,',
      'одним нажатием.',
      '/pay — неоплаченные занятия и абонемент.',
      '/help — это сообщение.',
      '',
      `Оплата, история и всё остальное: ${origin}/account`,
    ].join('\n');
}

/**
 * Нажатия на карточке заявки об оплате: способ, чек, подтверждение.
 *
 * Деньги проводит только админ. Проверяем это здесь, а не на кнопке:
 * карточка могла уехать в чат месяц назад, и роли с тех пор могли
 * поменяться.
 */
async function onMoney(
  id: string, chatId: number, messageId: number, data: string,
): Promise<boolean> {
  const tap = readMoneyTap(data);
  if (!tap) return false;

  const user = await chatUser(chatId);
  if (!user || !(await isStudioAdmin(user.id))) {
    await answerCallback(id, 'Деньги проводит админ.');
    return true;
  }

  const claim = await claimOf(tap.paymentId);
  if (!claim) {
    await answerCallback(id, 'Заявки больше нет.');
    return true;
  }
  // Подтвердили или отклонили с другого устройства, пока карточка висела.
  if (claim.status !== 'pending') {
    await answerCallback(id, 'Эту заявку уже закрыли.');
    await editMessage(chatId, messageId,
      `${claim.who}: ${claim.status === 'paid' ? 'оплата зачтена' : 'заявка закрыта'}.`);
    return true;
  }

  if (tap.kind === 'method' || tap.kind === 'back') {
    const card = claimCard(claim, tap.kind === 'method' ? tap.letter : null);
    await answerCallback(id);
    await editMessage(chatId, messageId, card.text, card.keyboard);
    return true;
  }

  if (tap.kind === 'decline') {
    await cashDeclined(tap.paymentId);
    await declineCash(tap.paymentId, user.id);
    await answerCallback(id, 'Отклонили');
    await editMessage(chatId, messageId, `${claim.who}: заявку отклонили. Родителю сказали.`);
    return true;
  }

  await confirmCash(tap.paymentId, user.id, {
    method: PAY_LETTER[tap.letter],
    receipt: tap.receipt,
  });
  await cashConfirmed(tap.paymentId);
  await answerCallback(id, 'Зачли');
  await editMessage(chatId, messageId, [
    `${claim.who}: оплата зачтена.`,
    `${claim.amount} ${claim.currency}, ${PAY_LETTER[tap.letter]}${
      tap.receipt ? ', чек выписан' : ', без чека'}.`,
    '',
    'Родителю сказали.',
  ].join('\n'));
  return true;
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
  await editMessage(chatId, messageId, view.text, view.keyboard, view.html);
}

/**
 * Нажатие на карточке чека: выбрана статья затрат или «не проводить».
 * Возвращает true, если кнопка была наша.
 */
async function onExpense(
  id: string, chatId: number, messageId: number, data: string,
): Promise<boolean> {
  const tap = readExpenseTap(data);
  if (!tap) return false;

  const user = await chatUser(chatId);
  if (!user || !(await isStudioAdmin(user.id))) {
    await answerCallback(id, 'Расходы проводит админ.');
    return true;
  }

  const before = await expenseById(tap.expenseId);
  if (!before) {
    await answerCallback(id, 'Этого чека больше нет.');
    return true;
  }
  if (before.status !== 'new') {
    await answerCallback(id, before.status === 'done' ? 'Уже проведён.' : 'Уже отклонён.');
    return true;
  }

  if (!tap.kindId) {
    await dropExpenseRow(tap.expenseId);
    await answerCallback(id, 'Не проводим.');
    await editMessage(chatId, messageId,
      `${before.supplier ?? 'Чек'}: не проводим. Снимок остался в «Расходах».`);
    return true;
  }

  await setKind(tap.expenseId, tap.kindId);
  const done = await pushExpense(tap.expenseId);
  const now = await expenseById(tap.expenseId);
  const what = `${now?.supplier ?? 'Чек'} · ${now?.amount ?? '?'} ${now?.currency ?? ''}`;

  if (done.ok) {
    await answerCallback(id, 'Провёл.');
    await editMessage(chatId, messageId,
      `${what}\n${now?.kind_title ?? ''} · проведено в iCount${
        done.icountId ? ` № ${done.icountId}` : ''}`);
  } else {
    await answerCallback(id, 'iCount отказал.');
    await editMessage(chatId, messageId, `${what}\nНе провёл: ${done.error}`);
  }
  return true;
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
      // Деньги идут своим путём: у них другие права и другая карточка.
      const data = tap.data ?? '';
      // Деньги идут своим путём: у них другие права и другая карточка.
      const money = await onMoney(tap.id, chatId, tap.message.message_id, data);
      const spent = money || await onExpense(tap.id, chatId, tap.message.message_id, data);
      if (!spent) await onTap(tap.id, chatId, tap.message.message_id, data, origin);
    } else if (chatId) {
      const text = (update.message?.text ?? '').trim();
      const photo = update.message?.photo ?? [];
      // Апдейты бывают всякие: вступление в чат, правка сообщения, стикер.
      // Нас касаются текст и снимок чека.
      const replyTo = update.message?.reply_to_message?.message_id ?? null;
      if (photo.length > 0) await onPhoto(chatId, photo, origin);
      else if (text) await onMessage(chatId, text, origin, replyTo);
    }
  } catch (err) {
    console.error('telegram: апдейт не обработан', err);
    if (tap?.id) await answerCallback(tap.id, 'Что-то сломалось. Попробуйте позже.');
    else if (chatId) await send(chatId, 'Что-то сломалось на нашей стороне. Попробуйте позже.');
  }
  return Response.json({ ok: true });
}
