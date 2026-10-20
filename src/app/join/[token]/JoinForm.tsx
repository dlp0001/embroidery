'use client';

import { useActionState } from 'react';
import { joinSendCode, joinVerify, type JoinState } from './actions';

// Имена полей те же, что в lib/form-guard: этот файл уходит в браузер,
// поэтому сам модуль защиты сюда не импортируем.
const TRAP_FIELD = 'website';
const STAMP_FIELD = 'stamp';

const initial: JoinState = { step: 'who', email: '', name: '' };

export default function JoinForm({ token, stamp }: { token: string; stamp: string }) {
  const [state, send, sending] = useActionState(joinSendCode, initial);

  if (state.step === 'who') {
    return (
      <form action={send}>
        <input type="hidden" name={STAMP_FIELD} value={stamp} />
        {/* Ловушка для ботов: человек это поле не видит и не заполнит. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Сайт<input name={TRAP_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
        </div>
        <div className="field">
          <label htmlFor="join-name">Имя и фамилия</label>
          <input id="join-name" name="name" required maxLength={120}
                 defaultValue={state.name} placeholder="Как вас зовут" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="join-email">Почта</label>
          <input id="join-email" name="email" type="email" inputMode="email" autoComplete="email"
                 required defaultValue={state.email} placeholder="anna@example.com" />
        </div>
        {state.error && <p className="err">{state.error}</p>}
        <button className="btn-wide" type="submit" disabled={sending}>
          {sending ? 'Отправляю…' : 'Получить код'}
        </button>
        <p className="hint" style={{ marginTop: 16 }}>
          Пароль не нужен. Пришлём код из шести цифр, он живёт десять минут.
          Этой же почтой вы потом входите в кабинет.
        </p>
      </form>
    );
  }

  return <CodeForm token={token} email={state.email} name={state.name} devCode={state.devCode} />;
}

function CodeForm({
  token, email, name, devCode,
}: { token: string; email: string; name: string; devCode?: string }) {
  const [state, verify, verifying] = useActionState(joinVerify, {
    step: 'code' as const, email, name,
  });

  if (state.step === 'stuck') {
    return (
      <>
        <p className="err">{state.error}</p>
        <p className="hint" style={{ marginTop: 16 }}>
          Попросите прислать новую ссылку — эта больше не годится.
        </p>
      </>
    );
  }

  return (
    <form action={verify}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="name" value={name} />
      <div className="field">
        <label htmlFor="join-code">Код из письма</label>
        <input id="join-code" name="code" inputMode="numeric" autoComplete="one-time-code"
               pattern="[0-9]*" maxLength={6} required placeholder="000000"
               defaultValue={devCode ?? ''} autoFocus />
      </div>
      {state.error && <p className="err">{state.error}</p>}
      <button className="btn-wide" type="submit" disabled={verifying}>
        {verifying ? 'Проверяю…' : 'Войти'}
      </button>
      <p className="hint" style={{ marginTop: 16 }}>Код отправлен на {email}.</p>
      {devCode && (
        <p className="note" style={{ marginTop: 16 }}>
          Режим разработки: письма не уходят. Код — <strong>{devCode}</strong>
        </p>
      )}
    </form>
  );
}
