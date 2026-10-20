'use client';

import { useState, useTransition } from 'react';

export type Parent = { id: string; name: string };

/**
 * Второй родитель: позвать по ссылке и решить, на кого студия выписывает
 * квитанции.
 *
 * Ссылку показываем только после нажатия: она одноразовая, и каждая
 * новая гасит прежнюю — открывать профиль не должно значить «выдать
 * ещё одну».
 */
export default function SecondParent({
  me,
  others,
  holder,
  invite,
  pick,
}: {
  me: Parent;
  others: Parent[];
  /** На кого студия выписывает квитанции: в семье это кто-то один. */
  holder: string;
  /** Заводит приглашение и возвращает ссылку. */
  invite: () => Promise<{ url?: string; error?: string }>;
  pick: (form: FormData) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [on, setOn] = useState(holder);

  function ask(): void {
    start(async () => {
      setError(null);
      const res = await invite();
      if (res.url) setLink(res.url);
      else setError(res.error ?? 'Не получилось. Попробуйте ещё раз.');
    });
  }

  function copy(): void {
    if (!link) return;
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }

  function choose(id: string): void {
    if (id === on) return;
    start(async () => {
      setOn(id);
      const form = new FormData();
      form.append('userId', id);
      await pick(form);
    });
  }

  const family = [me, ...others];

  return (
    <div className="card" style={{ borderStyle: others.length > 0 ? undefined : 'dashed' }}>
      <div className="what" style={{ marginBottom: 4 }}>
        {others.length > 0 ? 'Второй родитель' : 'Добавить второго родителя'}
      </div>

      {others.length > 0 ? (
        <>
          {others.map((p) => (
            <div className="sub" key={p.id} style={{ padding: '6px 0' }}>{p.name}</div>
          ))}
          <p className="hint" style={{ margin: '10px 0 0' }}>
            Видите одно и то же: детей, расписание, занятия и долги. Платить
            может любой из вас.
          </p>

          <div className="lbl" style={{ margin: '16px 0 0' }}>Квитанции выписывать на</div>
          <div className="days" style={{ marginTop: 8 }}>
            {family.map((p) => (
              <button
                key={p.id}
                type="button"
                className={on === p.id ? 'day-on' : 'day'}
                aria-pressed={on === p.id}
                disabled={pending}
                onClick={() => choose(p.id)}
                style={{ minWidth: 0, padding: '0 18px' }}
              >
                {p.id === me.id ? 'На меня' : p.name}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Имя в квитанции одно на семью, кто бы из вас ни заплатил: иначе
            одна семья разойдётся в отчётности на двух человек. Бумага
            приходит на почту того, кто выбран здесь.
          </p>
        </>
      ) : (
        <p className="hint" style={{ marginBottom: 14 }}>
          Он увидит тех же детей, расписание и занятия, сможет записывать и
          платить. Квитанции по умолчанию останутся на ваше имя.
        </p>
      )}

      {link === null ? (
        <button
          className="btn"
          type="button"
          disabled={pending}
          onClick={ask}
          style={{ marginTop: others.length > 0 ? 18 : 0 }}
        >
          {others.length > 0 ? 'Пригласить ещё одного' : 'Пригласить второго родителя'}
        </button>
      ) : (
        <div style={{ marginTop: others.length > 0 ? 18 : 0 }}>
          <div className="lbl">Ссылка для второго родителя</div>
          <input
            readOnly
            value={link}
            aria-label="Ссылка-приглашение"
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: '100%', marginTop: 6 }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
            <button className="btn" type="button" onClick={copy}>
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
            <span className="hint">Отправьте её в вотсапе. Годна неделю, один раз.</span>
          </div>
        </div>
      )}

      {error && <p className="hint" style={{ color: 'var(--rose-dark)', marginTop: 10 }}>{error}</p>}
    </div>
  );
}
