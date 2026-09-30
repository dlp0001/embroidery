'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Неделя целиком — это все занятия студии, включая те, куда семья не
 * ходит никогда. Отметка оставляет только свои дни: те, что отмечены в
 * профиле, куда уже записаны или куда ходили в последний месяц.
 *
 * Состояние живёт в адресе, а не в голове у экрана: страница серверная,
 * и так отметка переживает обновление и возврат «назад».
 */
export default function OnlyMine({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, go] = useTransition();

  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'center',
                    margin: '0 0 14px', cursor: 'pointer',
                    opacity: pending ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => go(() => router.push(e.target.checked ? '/account' : '/account?all=1'))}
        style={{ width: 20, height: 20 }}
      />
      <span className="hint">Только возможные дни посещений</span>
    </label>
  );
}
