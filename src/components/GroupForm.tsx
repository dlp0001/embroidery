import type { GroupRow } from '@/lib/studio';

const WEEK = [
  [1, 'понедельник'], [2, 'вторник'], [3, 'среда'], [4, 'четверг'],
  [5, 'пятница'], [6, 'суббота'], [7, 'воскресенье'],
] as const;

const field: React.CSSProperties = {
  width: '100%', padding: '11px 0', border: 0,
  borderBottom: '1.5px solid rgba(180,160,140,0.4)', background: 'transparent',
  fontSize: 16, outline: 'none',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 10, letterSpacing: '0.3em',
  textTransform: 'uppercase', color: 'var(--warm-gray)', marginBottom: 6,
};

/** Одна форма и на создание, и на правку: поля те же. */
export default function GroupForm({
  action,
  group,
  teacherList,
  submitLabel,
}: {
  action: (form: FormData) => void;
  group?: GroupRow;
  teacherList: { id: string; name: string | null; email: string }[];
  submitLabel: string;
}) {
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {group && <input type="hidden" name="id" value={group.id} />}

      <div>
        <label style={label} htmlFor={`title-${group?.id ?? 'new'}`}>Название</label>
        <input style={field} id={`title-${group?.id ?? 'new'}`} name="title" required
               maxLength={120} defaultValue={group?.title} placeholder="Младшие" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        <div>
          <label style={label} htmlFor={`weekday-${group?.id ?? 'new'}`}>День</label>
          <select style={field} id={`weekday-${group?.id ?? 'new'}`} name="weekday" defaultValue={group?.weekday ?? 3}>
            {WEEK.map(([n, name]) => <option key={n} value={n}>{name}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor={`startsAt-${group?.id ?? 'new'}`}>Время</label>
          <input style={field} id={`startsAt-${group?.id ?? 'new'}`} name="startsAt" type="time"
                 required defaultValue={group?.starts_at?.slice(0, 5) ?? '16:30'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={label} htmlFor={`audience-${group?.id ?? 'new'}`}>Тип</label>
          <select style={field} id={`audience-${group?.id ?? 'new'}`} name="audience" defaultValue={group?.audience ?? 'kids'}>
            <option value="kids">детское</option>
            <option value="adults">взрослое</option>
          </select>
        </div>
        <div>
          <label style={label} htmlFor={`durationMin-${group?.id ?? 'new'}`}>Минут</label>
          <input style={field} id={`durationMin-${group?.id ?? 'new'}`} name="durationMin"
                 type="number" min={15} max={300} step={5} defaultValue={group?.duration_min ?? 90} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={label} htmlFor={`ageHint-${group?.id ?? 'new'}`}>Возраст</label>
          <input style={field} id={`ageHint-${group?.id ?? 'new'}`} name="ageHint"
                 maxLength={40} defaultValue={group?.age_hint ?? ''} placeholder="6–8 лет" />
        </div>
        <div>
          <label style={label} htmlFor={`capacity-${group?.id ?? 'new'}`}>Мест</label>
          <input style={field} id={`capacity-${group?.id ?? 'new'}`} name="capacity"
                 type="number" min={1} max={100} defaultValue={group?.capacity ?? ''} placeholder="12" />
        </div>
      </div>

      <div>
        <label style={label} htmlFor={`teacherId-${group?.id ?? 'new'}`}>Преподаватель</label>
        <select style={field} id={`teacherId-${group?.id ?? 'new'}`} name="teacherId" defaultValue={group?.teacher_id ?? ''}>
          <option value="">не назначен</option>
          {teacherList.map((t) => (
            <option key={t.id} value={t.id}>{t.name ?? t.email}</option>
          ))}
        </select>
      </div>

      <button className="btn-wide" type="submit">{submitLabel}</button>
    </form>
  );
}
