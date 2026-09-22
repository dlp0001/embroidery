'use client';

import { useState, useTransition } from 'react';

/**
 * Время занятия с возможностью перенести его на этот один раз.
 *
 * Поле показывается только по нажатию: перенос — дело редкое, а поле
 * ввода рядом с каждым занятием в расписании выглядит так, будто время
 * всё время нужно править.
 */
export default function SessionTime({
  sessionId,
  startsAt,
  moved,
  action,
  canEdit,
}: {
  sessionId: string;
  /** Время, как его видно сейчас: своё у занятия или обычное у группы. */
  startsAt: string;
  /** Время уже переносили: занятие идёт не тогда, когда обычно. */
  moved: boolean;
  action: (form: FormData) => void | Promise<void>;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const hhmm = startsAt.slice(0, 5);

  /**
   * Сохранение закрывает поле. Без этого после нажатия на экране
   * оставалось поле ввода со своим крупным шрифтом и кнопки при нём,
   * и выглядело это так, будто ничего не произошло.
   */
  function save(form: FormData): void {
    start(async () => {
      await action(form);
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="when" style={{ display: 'flex', alignItems: 'baseline',
                                     gap: 10, flexWrap: 'wrap' }}>
        <span className="time-slot">{hhmm}</span>
        {moved && <span style={{ color: 'var(--rose)' }}>перенесено</span>}
        {canEdit && (
          <button type="button" className="linky" onClick={() => setOpen(true)}>
            Изменить время
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="when" style={{ display: 'flex', alignItems: 'center', gap: 14,
                                   flexWrap: 'wrap', marginBottom: 6 }}>
      <form action={save} style={{ display: 'flex', alignItems: 'center',
                                   gap: 10, flexWrap: 'wrap' }}>
        <input type="hidden" name="id" value={sessionId} />
        {/* Обычное текстовое поле, а не поле времени: цифры в поле времени
            рисует сам браузер, своей шириной и своим начертанием, и рядом
            с такой же строкой текста они всегда чуть другие. Проверку
            формата делает и поле, и сервер. */}
        <input
          type="text"
          name="startsAt"
          defaultValue={hhmm}
          aria-label="Время занятия"
          inputMode="numeric"
          maxLength={5}
          pattern="([01]?[0-9]|2[0-3])[:.]?[0-5][0-9]"
          title="Время в виде 09:00. Можно и 900, и 9:00."
          required
          autoComplete="off"
          disabled={pending}
          className="time-field"
        />
        <button type="submit" className="linky" disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </button>
        <button type="button" className="linky" onClick={() => setOpen(false)} disabled={pending}>
          Отмена
        </button>
      </form>

      {/* Возврат к обычному времени — своя форма, а не ещё одна кнопка в
          этой. Кнопка отправки со своим именем доезжает не во всяком
          браузере, а поле startsAt рядом всё равно победило бы её. */}
      {moved && (
        <form action={save}>
          <input type="hidden" name="id" value={sessionId} />
          <input type="hidden" name="usual" value="1" />
          <button type="submit" className="linky" disabled={pending}>Вернуть обычное</button>
        </form>
      )}
    </div>
  );
}
