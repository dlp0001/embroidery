import PeekSwitch from '@/components/PeekSwitch';
import type { CurrentUser } from '@/lib/session';
import type { CabinetOwner } from '@/lib/studio';
import { stopViewAction, viewAsAction } from '@/app/admin/view-actions';

/**
 * Полоса просмотра чужими глазами. Висит над всем содержимым и в
 * кабинете, и в журнале: забыть, что ты не у себя, дороже одной строки
 * на экране. Отсюда же можно перейти к другому человеку и на другую
 * сторону — из кабинета в журнал и обратно.
 */
export default function PeekBar({
  peek,
  owners,
  cross,
  back,
}: {
  peek: CurrentUser;
  owners: CabinetOwner[];
  cross?: { href: string; label: string };
  /** Где стоит полоса: в журнале переключение оставляет в журнале. */
  back?: string;
}) {
  return (
    <div className="peek">
      <span>
        Глазами:{' '}
        {owners.length > 1
          ? <PeekSwitch action={viewAsAction} people={owners} current={peek.id} back={back} />
          : <b style={{ color: 'var(--charcoal)' }}>{peek.name ?? peek.email}</b>}
      </span>
      <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        {cross && <a className="linky" href={cross.href}>{cross.label}</a>}
        <form action={stopViewAction}>
          <button className="linky" type="submit">Вернуться к себе</button>
        </form>
      </span>
      <span className="peek-note">только смотрите, менять ничего нельзя</span>
    </div>
  );
}
