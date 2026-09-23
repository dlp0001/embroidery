import { redirect } from 'next/navigation';
import { currentUser, isAdmin, isSuperadmin } from '@/lib/session';
import { cabinetOwners, mergeCandidates, type MergeCandidate } from '@/lib/studio';
import { mergeChildAction } from '@/app/admin/people-actions';
import { viewAsAction } from '@/app/admin/view-actions';

export const dynamic = 'force-dynamic';

/** Тёзок в студии хватает, поэтому в списке имя идёт с родителем. */
function label(c: MergeCandidate): string {
  const parts = [c.name];
  if (c.parent) parts.push(c.parent);
  if (c.archived) parts.push('скрыт');
  return parts.join(' · ');
}

export default async function AdminToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; error?: string }>;
}) {
  const user = await currentUser();
  // Закладка админская: преподавателю тут делать нечего.
  if (!user || !isAdmin(user)) redirect('/admin/studio');

  const { note, error } = await searchParams;
  const looker = isSuperadmin(user);
  const [kids, owners] = await Promise.all([
    mergeCandidates(),
    looker ? cabinetOwners() : [],
  ]);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Админ</div>
        <h1 className="h1">Админ</h1>
        <p className="sub">То, что нужно изредка и всей студии сразу</p>
      </div>

      <div className="body">
        {note && <p className="note" style={{ marginBottom: 14 }}>{note}</p>}
        {error && <p className="err" style={{ marginBottom: 14 }}>{error}</p>}

        <div className="card">
          <div className="what" style={{ marginBottom: 6 }}>Объединить детей</div>
          <p className="hint" style={{ marginBottom: 16 }}>
            Одного ребёнка заводят дважды: Варя на занятии, родитель в кабинете.
            Записи можно склеить, и не обязательно внутри одной семьи. Занятия,
            посещения, деньги и дни недели переедут в ту запись, которая
            остаётся; родители обеих станут её родителями. Первая запись
            исчезнет, отменить это нельзя.
          </p>

          {kids.length < 2 ? (
            <p className="hint">Склеивать пока нечего: в студии меньше двух детей.</p>
          ) : (
            <form action={mergeChildAction}
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="merge-from">Эта запись исчезнет</label>
                <select id="merge-from" name="childId" defaultValue="" required>
                  <option value="" disabled>— выберите ребёнка —</option>
                  {kids.map((c) => (
                    <option key={c.child_id} value={c.child_id}>{label(c)}</option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="merge-into">И станет этой</label>
                <select id="merge-into" name="intoChildId" defaultValue="" required>
                  <option value="" disabled>— выберите ребёнка —</option>
                  {kids.map((c) => (
                    <option key={c.child_id} value={c.child_id}>{label(c)}</option>
                  ))}
                </select>
              </div>

              <button className="btn-wide" type="submit">Объединить</button>
            </form>
          )}
        </div>

        {looker && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="what" style={{ marginBottom: 6 }}>Посмотреть кабинет родителя</div>
            <p className="hint" style={{ marginBottom: 16 }}>
              Открывает кабинет чужими глазами: те же занятия, долги и кнопки,
              что видит человек. Только смотреть — записать, оплатить или
              переименовать оттуда нельзя. Наверху будет полоса с возвратом
              к себе.
            </p>

            {owners.length === 0 ? (
              <p className="hint">Кабинетов пока ни у кого нет.</p>
            ) : (
              <form action={viewAsAction}
                    style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="view-as">Чей кабинет</label>
                  <select id="view-as" name="userId" defaultValue="" required>
                    <option value="" disabled>— выберите человека —</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>{o.name ?? o.email}</option>
                    ))}
                  </select>
                </div>

                <button className="btn-wide" type="submit">Посмотреть</button>
              </form>
            )}
          </div>
        )}
      </div>
    </>
  );
}
