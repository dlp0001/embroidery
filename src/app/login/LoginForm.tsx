'use client';

import { useActionState } from 'react';
import { sendCodeAction, verifyCodeAction, type LoginState } from './actions';

const initial: LoginState = { step: 'email', email: '' };

export default function LoginForm() {
  const [emailState, sendCode, sendingCode] = useActionState(sendCodeAction, initial);

  if (emailState.step === 'email') {
    return (
      <form action={sendCode}>
        <div className="field">
          <label htmlFor="email">Почта</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email"
                 required defaultValue={emailState.email} placeholder="anna@example.com" autoFocus />
        </div>
        {emailState.error && <p className="err">{emailState.error}</p>}
        <button className="btn-wide" type="submit" disabled={sendingCode}>
          {sendingCode ? 'Отправляю…' : 'Получить код'}
        </button>
        <p className="hint" style={{ marginTop: 16 }}>
          Пароль не нужен. Пришлём код из шести цифр, он живёт десять минут.
        </p>
      </form>
    );
  }

  return <CodeForm email={emailState.email} devCode={emailState.devCode} />;
}

function CodeForm({ email, devCode }: { email: string; devCode?: string }) {
  const [state, verify, verifying] = useActionState(verifyCodeAction, {
    step: 'code' as const,
    email,
  });

  return (
    <form action={verify}>
      <input type="hidden" name="email" value={email} />
      <div className="field">
        <label htmlFor="code">Код из письма</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code"
               pattern="[0-9]*" maxLength={6} required placeholder="000000" defaultValue={devCode ?? ''} autoFocus />
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
