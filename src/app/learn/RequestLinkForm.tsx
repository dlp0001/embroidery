'use client';

import { useActionState } from 'react';
import { requestLinkAction, type LinkState } from './actions';

/** Свежая ссылка на почту покупателя: потерял письмо, новое устройство, ссылка устарела. */
export default function RequestLinkForm({ course, button = 'Прислать ссылку' }: { course: string; button?: string }) {
  const [state, send, sending] = useActionState(requestLinkAction, {} as LinkState);

  if (state.sent) {
    return (
      <p className="gate-ok">
        Если {state.email} есть среди покупателей курса, письмо со ссылкой уже в пути.
        Загляните и в «Промоакции» или «Спам».
      </p>
    );
  }

  return (
    <form action={send}>
      <input type="hidden" name="course" value={course} />
      <input name="email" type="email" inputMode="email" autoComplete="email" required
             defaultValue={state.email} placeholder="почта, с которой покупали" aria-label="Почта" />
      <button className="btn" type="submit" disabled={sending}>
        {sending ? 'Отправляю…' : button}
      </button>
      {state.error && <p className="gate-note err">{state.error}</p>}
    </form>
  );
}
