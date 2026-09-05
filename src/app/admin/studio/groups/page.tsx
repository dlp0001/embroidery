import GroupForm from '@/components/GroupForm';
import { isAdmin, requireTeacher } from '@/lib/session';
import { allGroups, teachers } from '@/lib/studio';
import { hhmm, plural } from '@/lib/format';
import { createGroupAction, toggleGroupAction, updateGroupAction } from '@/app/admin/schedule-actions';

export const dynamic = 'force-dynamic';

const WD = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  const user = await requireTeacher();
  const admin = isAdmin(user);
  const { edit, new: creating } = await searchParams;

  const [groups, teacherList] = await Promise.all([allGroups(), admin ? teachers() : []]);
  const mine = admin ? groups : groups.filter((g) => g.teacher_id === user.id && g.active);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <div className="row">
          <h1 className="h1">Группы</h1>
          {admin && !creating && <a className="btn" href="/admin/studio/groups?new=1">Новая</a>}
        </div>
      </div>

      <div className="body">
        {admin && creating && (
          <div className="card" style={{ borderStyle: 'dashed', padding: '20px 18px' }}>
            <div className="what" style={{ marginBottom: 18 }}>Новая группа</div>
            <GroupForm action={createGroupAction} teacherList={teacherList} submitLabel="Создать" />
            <a className="hint" href="/admin/studio/groups" style={{ display: 'block', marginTop: 14 }}>
              Отмена
            </a>
          </div>
        )}

        {mine.map((g) => {
          const editing = admin && edit === g.id;
          return (
            <div className="card" key={g.id} style={{ opacity: g.active ? 1 : 0.55 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="when">{WD[g.weekday]} {hhmm(g.starts_at)} · {g.duration_min} мин</div>
                  <div className="what">{g.title}</div>
                  <div className="sub">
                    {g.audience === 'adults' ? 'взрослое' : 'детское'}
                    {g.age_hint ? ` · ${g.age_hint}` : ''} · {g.people}&nbsp;
                    {plural(g.people, 'человек', 'человека', 'человек')}
                    {g.capacity ? ` из ${g.capacity}` : ''}
                    {!g.active && ' · в архиве'}
                  </div>
                </div>
                {admin && !editing && (
                  <a className="btn-quiet" href={`/admin/studio/groups?edit=${g.id}`}>Править</a>
                )}
              </div>

              {editing && (
                <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
                  <GroupForm
                    action={updateGroupAction}
                    group={g}
                    teacherList={teacherList}
                    submitLabel="Сохранить"
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                    <a className="hint" href="/admin/studio/groups">Отмена</a>
                    <form action={toggleGroupAction}>
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="active" value={g.active ? '0' : '1'} />
                      <button className="btn-quiet" type="submit">
                        {g.active ? 'В архив' : 'Вернуть'}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {mine.length === 0 && <p className="hint" style={{ marginTop: 20 }}>Групп пока нет.</p>}

        {admin && (
          <p className="hint" style={{ marginTop: 18 }}>
            Занятия по расписанию группы создаются сами на шесть недель вперёд.
            Разовое занятие вне расписания добавляется в календаре.
          </p>
        )}
      </div>
    </>
  );
}
