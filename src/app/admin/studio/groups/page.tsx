import { isAdmin, requireTeacher } from '@/lib/session';
import { groupsOverview } from '@/lib/studio';
import { hhmm, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

const WD = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const AUDIENCE: Record<string, string> = { kids: 'Дети', teens: 'Подростки', adults: 'Взрослые' };

export default async function GroupsPage() {
  const user = await requireTeacher();
  const groups = await groupsOverview(isAdmin(user) ? null : user.id);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Группы</h1>
      </div>
      <div className="body">
        {groups.map((g) => (
          <div className="card" key={g.id}>
            <div className="row">
              <div>
                <div className="when">{WD[g.weekday]} {hhmm(g.starts_at)}</div>
                <div className="what">{g.title}</div>
                <div className="sub">
                  {AUDIENCE[g.audience] ?? g.audience}{g.age_hint ? ` · ${g.age_hint}` : ''} · {g.people}&nbsp;{plural(g.people, 'человек', 'человека', 'человек')}
                </div>
              </div>
              <div className="tag tag-ok">{g.active_passes}&nbsp;{plural(g.active_passes, 'абонемент', 'абонемента', 'абонементов')}</div>
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="hint" style={{ marginTop: 20 }}>Групп пока нет.</p>}
      </div>
    </>
  );
}
