'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SaveResult } from '@/components/AutoSave';

export type Line = {
  id: string;
  sku: string | null;
  name: string;
  qty: string | null;
  sum: string | null;
  kind_guess: string | null;
};

/** Машинные группы по-русски. Те же пять, на которых говорит модель. */
const WORD: Record<string, string> = {
  materials: 'материалы',
  stationery: 'канцелярия',
  equipment: 'оборудование',
  food: 'еда',
  other: 'прочее',
};

/**
 * Строки чека под самим чеком: раскрываются нажатием и дают поменять
 * группу у любой строки.
 *
 * Это правка нашей разбивки, а не денег: расход уже проведён в iCount
 * одной суммой и одной статьёй, и трогать его отсюда нельзя. Поэтому
 * список не спрашивает подтверждений — ошибка стоит одного нажатия
 * обратно.
 */
export default function Lines({
  lines,
  action,
  total,
}: {
  lines: Line[];
  action: (form: FormData) => Promise<SaveResult>;
  /** Сумма чека: по ней видно, сошлись ли строки. */
  total: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (lines.length === 0) return null;

  const sum = lines.reduce((s, l) => s + Number(l.sum ?? 0), 0);
  const off = total === null ? 0 : Math.abs(sum - total);

  function pick(lineId: string, guess: string): void {
    const form = new FormData();
    form.set('lineId', lineId);
    form.set('guess', guess);
    start(async () => {
      await action(form);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="linky" style={{ marginTop: 10 }}
              aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Свернуть строки' : `Строки чека · ${lines.length}`}
      </button>

      <div style={{ display: open ? undefined : 'none', marginTop: 10 }}>
        {off >= 0.01 && (
          <p className="hint" style={{ marginBottom: 8, color: 'var(--rose-dark)' }}>
            Строки дают {sum.toFixed(2)}, а в чеке {total?.toFixed(2)}: что-то
            прочиталось не полностью.
          </p>
        )}
        {lines.map((l) => (
          <div key={l.id}
               style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10,
                        alignItems: 'baseline', padding: '7px 0',
                        borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{l.name}</div>
              {l.sku && <div className="hint" style={{ fontSize: 11 }}>{l.sku}</div>}
            </div>
            <div style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
              {l.sum === null ? '—' : Number(l.sum).toFixed(2)}
            </div>
            <select
              value={l.kind_guess ?? 'other'}
              disabled={pending}
              aria-label={`Группа строки «${l.name}»`}
              onChange={(e) => pick(l.id, e.target.value)}
              style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'transparent',
                       fontFamily: 'inherit', fontSize: 12.5, padding: '2px 0', outline: 'none' }}
            >
              {Object.entries(WORD).map(([key, word]) => (
                <option key={key} value={key}>{word}</option>
              ))}
            </select>
          </div>
        ))}
        <p className="hint" style={{ marginTop: 10 }}>
          Группа строки — только наша разбивка для отчётов. Расход в iCount
          уже проведён одной суммой, и правка сюда не доходит.
        </p>
      </div>
    </>
  );
}
