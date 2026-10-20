'use client';

import { useState, useTransition } from 'react';

/**
 * Кнопка «пригласить» и выданная ссылка рядом с ней.
 *
 * Ссылку показываем только после нажатия: она одноразовая, и каждая
 * новая гасит прежнюю — открывать страницу не должно значить «выдать
 * ещё одну».
 *
 * Одна на двоих: ссылку выдаёт и родитель себе в профиле, и Варя из
 * «Людей». Разница только в действии, которое ей передают.
 */
export default function InviteLink({
  invite,
  userId,
  label,
  hint,
  style,
}: {
  /** Заводит приглашение и возвращает ссылку. */
  invite: (form: FormData) => Promise<{ url?: string; error?: string }>;
  /** Кого приглашают в семью. Пусто — свою собственную. */
  userId?: string;
  label: string;
  hint: string;
  style?: React.CSSProperties;
}) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function ask(): void {
    start(async () => {
      setError(null);
      const form = new FormData();
      if (userId) form.append('userId', userId);
      const res = await invite(form);
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

  if (link !== null) {
    return (
      <div style={style}>
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
          <span className="hint">{hint}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={style}>
      <button className="btn" type="button" disabled={pending} onClick={ask}>
        {label}
      </button>
      {error && <p className="hint" style={{ color: 'var(--rose-dark)', marginTop: 10 }}>{error}</p>}
    </div>
  );
}
