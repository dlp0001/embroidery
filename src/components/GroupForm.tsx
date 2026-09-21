'use client';

import { useState } from 'react';
import type { GroupKind, GroupRow } from '@/lib/studio';

const WEEK = [
  [1, 'понедельник'], [2, 'вторник'], [3, 'среда'], [4, 'четверг'],
  [5, 'пятница'], [6, 'суббота'], [7, 'воскресенье'],
] as const;

const SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const field: React.CSSProperties = {
  width: '100%', padding: '11px 0', border: 0,
  borderBottom: '1.5px solid rgba(180,160,140,0.4)', background: 'transparent',
  fontSize: 16, outline: 'none',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 10, letterSpacing: '0.3em',
  textTransform: 'uppercase', color: 'var(--warm-gray)', marginBottom: 6,
};

/** «5 дней — 1550, 6 — 1800» — так пакеты и пишутся, и читаются. */
function offersText(group?: GroupRow): string {
  return (group?.pass_offers ?? []).map((o) => `${o.lessons} — ${o.price}`).join(', ');
}

/**
 * Одна форма на все виды занятий. У обычной группы день недели и время,
 * у лагеря и мастер-класса — период, свои дни, своя цена и свои пакеты.
 */
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
  const id = group?.id ?? 'new';
  const [kind, setKind] = useState<GroupKind>(group?.kind ?? 'lesson');
  const weekly = kind === 'lesson';

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {group && <input type="hidden" name="id" value={group.id} />}

      <div>
        <label style={label} htmlFor={`title-${id}`}>Название</label>
        <input style={field} id={`title-${id}`} name="title" required
               maxLength={120} defaultValue={group?.title} placeholder="Младшие" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        <div>
          <label style={label} htmlFor={`kind-${id}`}>Что это</label>
          <select style={field} id={`kind-${id}`} name="kind" value={kind}
                  onChange={(e) => setKind(e.target.value as GroupKind)}>
            <option value="lesson">обычные занятия</option>
            <option value="camp">лагерь</option>
            <option value="event">мастер-класс</option>
          </select>
        </div>
        <div>
          <label style={label} htmlFor={`startsAt-${id}`}>Время</label>
          <input style={field} id={`startsAt-${id}`} name="startsAt" type="time"
                 required defaultValue={group?.starts_at?.slice(0, 5) ?? '16:30'} />
        </div>
      </div>

      {weekly ? (
        <div>
          <label style={label} htmlFor={`weekday-${id}`}>День</label>
          <select style={field} id={`weekday-${id}`} name="weekday" defaultValue={group?.weekday ?? 3}>
            {WEEK.map(([n, name]) => <option key={n} value={n}>{name}</option>)}
          </select>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={label} htmlFor={`startsOn-${id}`}>С какого дня</label>
              <input style={field} id={`startsOn-${id}`} name="startsOn" type="date"
                     required defaultValue={group?.starts_on ?? ''} />
            </div>
            <div>
              <label style={label} htmlFor={`endsOn-${id}`}>По какой</label>
              <input style={field} id={`endsOn-${id}`} name="endsOn" type="date"
                     required defaultValue={group?.ends_on ?? ''} />
            </div>
          </div>

          <div>
            <span style={label}>Дни недели</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {WEEK.map(([n]) => (
                <label key={n} className="chip" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" name="weekdays" value={n}
                         defaultChecked={group?.weekdays?.includes(n) ?? n <= 5}
                         style={{ marginRight: 6 }} />
                  {SHORT[n]}
                </label>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              Дни внутри периода, по которым заводить занятия.
            </p>
          </div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={label} htmlFor={`audience-${id}`}>Для кого</label>
          <select style={field} id={`audience-${id}`} name="audience" defaultValue={group?.audience ?? 'kids'}>
            <option value="kids">детское</option>
            <option value="adults">взрослое</option>
          </select>
        </div>
        <div>
          <label style={label} htmlFor={`durationMin-${id}`}>Минут</label>
          <input style={field} id={`durationMin-${id}`} name="durationMin"
                 type="number" min={15} max={600} step={5} defaultValue={group?.duration_min ?? 90} />
        </div>
      </div>

      {!weekly && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <div>
            <label style={label} htmlFor={`price-${id}`}>Цена дня</label>
            <input style={field} id={`price-${id}`} name="price" type="number"
                   min={0} max={100000} step={10} required
                   defaultValue={group?.price ? Number(group.price) : ''} placeholder="330" />
          </div>
          <div>
            <label style={label} htmlFor={`passOffers-${id}`}>Пакеты</label>
            <input style={field} id={`passOffers-${id}`} name="passOffers"
                   defaultValue={offersText(group)} placeholder="5 — 1550, 6 — 1800, 7 — 2000" />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={label} htmlFor={`ageHint-${id}`}>Возраст</label>
          <input style={field} id={`ageHint-${id}`} name="ageHint"
                 maxLength={40} defaultValue={group?.age_hint ?? ''} placeholder="6–8 лет" />
        </div>
        <div>
          <label style={label} htmlFor={`capacity-${id}`}>Мест</label>
          <input style={field} id={`capacity-${id}`} name="capacity"
                 type="number" min={1} max={100} defaultValue={group?.capacity ?? ''} placeholder="12" />
        </div>
      </div>

      <div>
        <label style={label} htmlFor={`teacherId-${id}`}>Преподаватель</label>
        <select style={field} id={`teacherId-${id}`} name="teacherId" defaultValue={group?.teacher_id ?? ''}>
          <option value="">не назначен</option>
          {teacherList.map((t) => (
            <option key={t.id} value={t.id}>{t.name ?? t.email}</option>
          ))}
        </select>
      </div>

      {!weekly && (
        <p className="hint">
          Дни заведутся сами по периоду. Обычное расписание при этом не
          меняется: если занятия в какой-то из дней не будет, снимите его
          в календаре.
        </p>
      )}

      <button className="btn-wide" type="submit">{submitLabel}</button>
    </form>
  );
}
