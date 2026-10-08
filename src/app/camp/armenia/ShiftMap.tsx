'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Карта смены: нарисованный лагерь и маршрут ребёнка по дням.
 *
 * Выбираешь день — человечек проходит его маршрут пунктиром-строчкой,
 * а справа подсвечивается, где он сейчас и во сколько. Маршруты прошлых
 * дней остаются тонкими нитками, и к концу смены карта прошита вдоль
 * и поперёк, как вышивка.
 *
 * Карта примерная: место ещё выбирается, расположение домиков и тропинок
 * придумано. Дни — те же, что обещаны на странице.
 */

type PlaceId =
  | 'gate' | 'houses' | 'dining' | 'meadow' | 'studio' | 'stage' | 'fire'
  | 'brook' | 'forest' | 'lake' | 'hill' | 'monastery' | 'village';

type Place = {
  name: string;
  x: number;
  y: number;
  /** Подпись: по умолчанию под значком. */
  lx?: number;
  ly?: number;
  anchor?: 'start' | 'middle' | 'end';
};

const PLACES: Record<PlaceId, Place> = {
  gate: { name: 'Ворота', x: 660, y: 590 },
  houses: { name: 'Домики', x: 300, y: 575 },
  dining: { name: 'Столовая', x: 432, y: 585 },
  meadow: { name: 'Поляна', x: 380, y: 455 },
  studio: { name: 'Мастерская', x: 540, y: 455 },
  stage: { name: 'Сцена', x: 572, y: 548 },
  fire: { name: 'Костёр', x: 262, y: 470 },
  brook: { name: 'Ручей', x: 108, y: 500 },
  forest: { name: 'Лес', x: 196, y: 338 },
  lake: { name: 'Озеро', x: 140, y: 160 },
  hill: { name: 'Холм', x: 560, y: 268 },
  monastery: { name: 'Монастырь', x: 690, y: 118 },
  village: { name: 'Деревня', x: 712, y: 388 },
};

type Stop = { at: string; place: PlaceId; what: string };
type Day = { title: string; stops: Stop[] };

const DAYS: Day[] = [
  {
    title: 'Приезд',
    stops: [
      { at: '13:00', place: 'gate', what: 'Автобус из аэропорта, все вместе' },
      { at: '14:00', place: 'houses', what: 'Расселяемся и раскладываем вещи' },
      { at: '15:00', place: 'dining', what: 'Первый обед — абрикосы прилагаются' },
      { at: '17:00', place: 'meadow', what: 'Игры на знакомство, учим имена' },
      { at: '20:30', place: 'fire', what: 'Договариваемся, как мы здесь живём' },
      { at: '22:00', place: 'houses', what: 'Первый отбой' },
    ],
  },
  {
    title: 'Обживаемся',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Первый утренний круг: Гриша учит петь всех сразу' },
      { at: '10:00', place: 'studio', what: 'Открываем мастерскую: где что лежит и что можно трогать (всё)' },
      { at: '15:30', place: 'forest', what: 'Гуляем вокруг лагеря, ищем тропинки' },
      { at: '17:30', place: 'hill', what: 'Первый пленэр: горы с вершины холма' },
      { at: '20:00', place: 'stage', what: 'Вечер, где каждый показывает, что умеет — или не умеет' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'Ткань и нитка',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Утренний круг' },
      { at: '10:00', place: 'studio', what: 'Первые стежки и роспись по ткани' },
      { at: '15:30', place: 'dining', what: 'Кухня: печём гату вместе с поваром' },
      { at: '20:00', place: 'fire', what: 'Песни у костра — Гриша достаёт балалайку' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'Поход к озеру',
    stops: [
      { at: '8:00', place: 'meadow', what: 'Собираем рюкзаки: лайфхак дня — как уложить всё и не тащить лишнего' },
      { at: '9:30', place: 'forest', what: 'Тропа через лес, альбомы с собой' },
      { at: '12:00', place: 'lake', what: 'Привал и пленэр: рисуем воду' },
      { at: '15:00', place: 'brook', what: 'Записываем звуки воды для карты звуков' },
      { at: '21:30', place: 'houses', what: 'Ранний отбой — все устали' },
    ],
  },
  {
    title: 'Краски из земли',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Утренний круг' },
      { at: '10:00', place: 'brook', what: 'Собираем глину, орехи и луковую шелуху' },
      { at: '11:30', place: 'studio', what: 'Варим краски и красим ткань' },
      { at: '16:00', place: 'village', what: 'Рынок: гранаты для краски, персики для себя' },
      { at: '20:00', place: 'stage', what: 'Кино под открытым небом' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'Монастырь',
    stops: [
      { at: '8:30', place: 'gate', what: 'Едем на автобусе' },
      { at: '10:30', place: 'monastery', what: 'Песня под сводами и резные камни в альбом' },
      { at: '16:00', place: 'gate', what: 'Возвращаемся' },
      { at: '17:00', place: 'studio', what: 'Срисованные узоры превращаем в свои' },
      { at: '20:30', place: 'fire', what: 'Тайный друг: тянем бумажки с именами' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'Рисованная партитура',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Утренний круг' },
      { at: '10:00', place: 'studio', what: 'Рисуем ноты по-своему: линии, пятна, узоры' },
      { at: '15:30', place: 'stage', what: 'Гриша и ансамбль играют наши рисунки' },
      { at: '18:00', place: 'dining', what: 'Ужин сегодня готовим сами' },
      { at: '21:00', place: 'hill', what: 'Рисуем светом под звёздами' },
      { at: '22:30', place: 'houses', what: 'Отбой, по случаю звёзд попозже' },
    ],
  },
  {
    title: 'Большое дело начинается',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Утренний круг' },
      { at: '10:00', place: 'studio', what: 'Выбираем общий проект и ставим камеру для таймлапса' },
      { at: '15:30', place: 'forest', what: 'Собираем палки и шишки для декораций' },
      { at: '17:30', place: 'meadow', what: 'Ленд-арт из того, что не пригодилось' },
      { at: '20:00', place: 'fire', what: 'Звёзды и страшные (не очень) истории' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'Собиратели песен',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Утренний круг' },
      { at: '10:00', place: 'studio', what: 'Большое дело: строим и шьём' },
      { at: '15:00', place: 'village', what: 'Просим бабушек спеть и записываем' },
      { at: '20:00', place: 'stage', what: 'Разучиваем песню из деревни' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'Гости из художественной школы',
    stops: [
      { at: '10:00', place: 'gate', what: 'Встречаем армянских ребят' },
      { at: '11:00', place: 'hill', what: 'Общий пленэр' },
      { at: '13:30', place: 'dining', what: 'Обед на всех' },
      { at: '16:00', place: 'stage', what: 'Концерт: балалайка встречает дудук' },
      { at: '18:00', place: 'meadow', what: 'Учимся танцевать кочари' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'День, которым правят дети',
    stops: [
      { at: '9:30', place: 'houses', what: 'Подъём — во сколько решили дети' },
      { at: '11:00', place: 'studio', what: 'Большое дело — по их плану' },
      { at: '15:00', place: 'brook', what: 'Солнечная печать: травы на ткани' },
      { at: '20:00', place: 'stage', what: 'Их вечерняя программа и свежий номер газеты' },
      { at: '22:00', place: 'houses', what: 'Отбой — его, так и быть, оставили взрослым' },
    ],
  },
  {
    title: 'Песня смены',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Утренний круг' },
      { at: '10:00', place: 'studio', what: 'Пишем слова и музыку' },
      { at: '15:30', place: 'stage', what: 'Записываем в переносной студии' },
      { at: '18:30', place: 'hill', what: 'Рисуем обложку на закате' },
      { at: '22:00', place: 'houses', what: 'Отбой' },
    ],
  },
  {
    title: 'Вернисаж',
    stops: [
      { at: '8:30', place: 'meadow', what: 'Утренний круг — последний полный' },
      { at: '10:00', place: 'studio', what: 'Развешиваем работы, пишем этикетки' },
      { at: '16:00', place: 'dining', what: 'Готовим ужин для гостей' },
      { at: '19:00', place: 'stage', what: 'Выставка и концерт: оркестр из найденного, показ мод' },
      { at: '21:30', place: 'fire', what: 'Пишем письма себе через год' },
      { at: '22:30', place: 'houses', what: 'Последний отбой' },
    ],
  },
  {
    title: 'Домой',
    stops: [
      { at: '8:00', place: 'houses', what: 'Собираем чемоданы — и книжку работ' },
      { at: '9:30', place: 'meadow', what: 'Тайный друг раскрывается' },
      { at: '11:00', place: 'dining', what: 'Последний обед' },
      { at: '12:30', place: 'gate', what: 'Автобус в аэропорт. До встречи!' },
    ],
  },
];

/** Те же четыре части смены, что и в рассказе о ней. */
const PHASES: { from: number; to: number; t: string; d: string }[] = [
  { from: 1, to: 2, t: 'Обживаемся', d: 'Знакомимся, расселяемся, договариваемся, как мы здесь живём.' },
  { from: 3, to: 7, t: 'Пробуем всё', d: 'Мастерские по кругу, первый поход, первый пленэр. Каждый ищет, что ему по-настоящему интересно.' },
  { from: 8, to: 12, t: 'Большое дело', d: 'Смена собирается вокруг общего проекта — того, что одному не сделать.' },
  { from: 13, to: 14, t: 'Вернисаж', d: 'Выставка, концерт, прощальный костёр — и домой.' },
];

type Pt = [number, number];

/**
 * Тропинка через остановки дня. Между далёкими точками вставляем изгиб,
 * чтобы путь петлял, как настоящая тропа, а не шёл по линейке; дальше
 * сглаживаем, и кривая проходит ровно через каждую остановку.
 */
function trail(stops: Stop[], seed: number): string {
  const pts: Pt[] = [];
  stops.forEach((s, i) => {
    const p = PLACES[s.place];
    if (i > 0) {
      const q = PLACES[stops[i - 1].place];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const len = Math.hypot(dx, dy);
      if (len > 90) {
        const side = (i + seed) % 2 === 0 ? 1 : -1;
        const k = (side * 0.16 * Math.min(len, 400)) / len;
        pts.push([(q.x + p.x) / 2 - dy * k, (q.y + p.y) / 2 + dx * k]);
      }
    }
    pts.push([p.x, p.y]);
  });

  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}`
      + ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const TRAILS = DAYS.map((d, i) => trail(d.stops, i));
const THREADS = ['#e91e8c', '#f4a259', '#1a1a2e'];

/** Скорость человечка в единицах карты за миллисекунду и пауза на остановке. */
const SPEED = 0.36;
const PAUSE = 1000;

const ease = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;

type Walk = { pos: number; x: number; y: number } | null;

export default function ShiftMap() {
  const [day, setDay] = useState(0);
  /** null — маршрут показан целиком и без человечка: так он выглядит до первого показа. */
  const [walk, setWalk] = useState<Walk>(null);
  const [lens, setLens] = useState<number[]>([]);
  const [started, setStarted] = useState(false);
  const [all, setAll] = useState(false);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const route = useRef<SVGPathElement>(null);
  const frame = useRef<number | null>(null);
  const next = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stops = DAYS[day].stops;

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (next.current !== null) clearTimeout(next.current);
    frame.current = null;
    next.current = null;
    setPlaying(false);
  }, []);

  // Где на тропе стоит каждая остановка. Тропа проходит ровно через
  // точки, поэтому идём по ней по порядку и берём первое место, где она
  // подошла к остановке вплотную. Ближайшее по всей тропе не годится:
  // в домики приходят и утром, и вечером.
  useLayoutEffect(() => {
    const path = route.current;
    if (!path) return;
    const total = path.getTotalLength();
    const N = 900;
    const out: number[] = [];
    let k = 0;
    for (const s of stops) {
      const p = PLACES[s.place];
      let best = k;
      let bestD = Infinity;
      for (let j = k; j <= N; j++) {
        const pt = path.getPointAtLength((total * j) / N);
        const dist = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (dist < bestD) { bestD = dist; best = j; }
        else if (bestD < 8) break;
      }
      out.push((total * best) / N);
      k = best + 1;
    }
    out[0] = 0;
    out[out.length - 1] = total;
    setLens(out);
    // Новый день начинается с первой остановки, а не с того места,
    // где человечек стоял вчера.
    if (started) {
      const first = PLACES[stops[0].place];
      setWalk({ pos: 0, x: first.x, y: first.y });
    }
    // started читаем как есть: пересчитывать тропу из-за него не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, stops]);

  // Карта начинает ходить, когда до неё долистали, а не на загрузке.
  // Следим за самой картой: весь блок со списком на телефоне выше экрана,
  // и нужная доля его на экран никогда не помещается.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setStarted(true);
        io.disconnect();
      }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const path = route.current;
    if (!started || !path || lens.length !== stops.length) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      const end = lens[lens.length - 1];
      const pt = path.getPointAtLength(end);
      setWalk({ pos: end, x: pt.x, y: pt.y });
      return;
    }

    const plan: { start: number; end: number; from: number; to: number }[] = [];
    let t = PAUSE * 0.6;
    for (let i = 0; i < lens.length - 1; i++) {
      const dur = Math.max((lens[i + 1] - lens[i]) / SPEED, 300);
      plan.push({ start: t, end: t + dur, from: lens[i], to: lens[i + 1] });
      t += dur + PAUSE;
    }
    const finish = t - PAUSE * 0.4;

    const t0 = performance.now();
    setPlaying(true);
    const tick = (now: number) => {
      const el = now - t0;
      let pos = lens[0];
      for (const seg of plan) {
        if (el < seg.start) { pos = seg.from; break; }
        if (el <= seg.end) { pos = seg.from + (seg.to - seg.from) * ease((el - seg.start) / (seg.end - seg.start)); break; }
        pos = seg.to;
      }
      const pt = path.getPointAtLength(pos);
      setWalk({ pos, x: pt.x, y: pt.y });
      if (el < finish) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
        setPlaying(false);
        if (all) {
          if (day < DAYS.length - 1) next.current = setTimeout(() => setDay((d) => d + 1), 900);
          else setAll(false);
        }
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    // all читается в момент окончания дня; перезапускать из-за него ход не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, lens, run]);

  useEffect(() => () => { if (next.current !== null) clearTimeout(next.current); }, []);

  function pick(i: number) {
    stop();
    setAll(false);
    setStarted(true);
    if (i === day) setRun((r) => r + 1);
    else setDay(i);
  }

  function jump(i: number) {
    const path = route.current;
    if (!path || lens.length !== stops.length) return;
    stop();
    setAll(false);
    const pt = path.getPointAtLength(lens[i]);
    setWalk({ pos: lens[i], x: pt.x, y: pt.y });
  }

  function wholeShift() {
    stop();
    setAll(true);
    setStarted(true);
    if (day === 0) setRun((r) => r + 1);
    else setDay(0);
  }

  // Какая остановка сейчас: последняя, до которой человечек дошёл.
  let now = -1;
  if (walk && lens.length === stops.length) {
    for (let i = 0; i < lens.length; i++) if (lens[i] <= walk.pos + 0.5) now = i;
  }
  const today = new Set(stops.map((s) => s.place));
  const here = now >= 0 ? stops[now].place : null;
  const total = lens.length ? lens[lens.length - 1] : 0;
  const phase = PHASES.find((p) => day + 1 >= p.from && day + 1 <= p.to)!;

  return (
    <div className="sm">
      <div className="sm-chips" role="group" aria-label="День смены">
        {PHASES.map((p) => (
          <div className="sm-group" key={p.t}>
            <div className="sm-phase">{p.t}</div>
            <div className="sm-row">
              {DAYS.slice(p.from - 1, p.to).map((_, j) => {
                const i = p.from - 1 + j;
                return (
                  <button key={i} type="button" className={i === day ? 'sm-chip is-on' : i < day ? 'sm-chip is-past' : 'sm-chip'}
                          aria-pressed={i === day} aria-label={`День ${i + 1}: ${DAYS[i].title}`} onClick={() => pick(i)}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="sm-grid">
        <div className="sm-map" ref={box}>
          <div className="sm-now" aria-live="polite">
            {now >= 0
              ? <><b>{stops[now].at}</b> {PLACES[stops[now].place].name}</>
              : <><b>День {day + 1}</b> {DAYS[day].title}</>}
          </div>
          <svg viewBox="0 0 800 640" role="img" aria-label={`Карта лагеря: маршрут дня ${day + 1}`}>
            <defs>
              <mask id="sm-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="800" height="640">
                <path d={TRAILS[day]} fill="none" stroke="#fff" strokeWidth="14" strokeLinecap="round"
                      strokeDasharray={walk && total ? `${total} ${total}` : undefined}
                      strokeDashoffset={walk && total ? total - walk.pos : undefined} />
              </mask>
            </defs>

            <Scenery />

            {/* Нитки прошлых дней: к концу смены их тринадцать. */}
            {TRAILS.slice(0, day).map((d, i) => (
              <path key={i} d={d} fill="none" stroke={THREADS[i % THREADS.length]} strokeOpacity="0.22"
                    strokeWidth="1.6" strokeDasharray="4 5" strokeLinecap="round" />
            ))}

            {/* Сегодняшний путь: целиком бледно, пройденное — ярко. */}
            <path d={TRAILS[day]} fill="none" stroke="#e91e8c" strokeOpacity="0.16" strokeWidth="3"
                  strokeDasharray="9 8" strokeLinecap="round" />
            <path ref={route} d={TRAILS[day]} fill="none" stroke="#e91e8c" strokeWidth="3.4"
                  strokeDasharray="9 8" strokeLinecap="round" mask="url(#sm-reveal)" />

            {(Object.keys(PLACES) as PlaceId[]).map((id) => {
              const p = PLACES[id];
              const cls = id === here ? 'sm-pin is-here' : today.has(id) ? 'sm-pin is-today' : 'sm-pin';
              return (
                <g key={id} className={cls} transform={`translate(${p.x} ${p.y})`}>
                  {id === here && <circle className="sm-pulse" r="16" />}
                  <circle className="sm-dot" r="15" />
                  <Icon id={id} />
                  <text className="sm-label" x={p.lx ?? 0} y={p.ly ?? 36} textAnchor={p.anchor ?? 'middle'}>{p.name}</text>
                </g>
              );
            })}

            {walk && (
              <g className="sm-walker" transform={`translate(${walk.x} ${walk.y - 24})`} aria-hidden="true">
                <path d="M0 22 L-6 10 A11 11 0 1 1 6 10 Z" fill="#1a1a2e" />
                <circle cy="0" r="7.5" fill="#fff" />
                <circle cy="-1.5" r="2.4" fill="#e91e8c" />
                <path d="M-3.5 4.2 Q0 2 3.5 4.2" fill="none" stroke="#e91e8c" strokeWidth="1.6" strokeLinecap="round" />
              </g>
            )}
          </svg>
          <p className="sm-legend">
            <span className="sm-key sm-key-now" /> маршрут дня
            <span className="sm-key sm-key-old" /> прошлые дни
            <span className="sm-aside">Карта примерная: место ещё выбираем.</span>
          </p>
        </div>

        <div className="sm-panel">
          <div className="sm-day">День {day + 1}</div>
          <div className="sm-title">{DAYS[day].title}</div>
          <p className="sm-note"><b>Дни {phase.from}–{phase.to} · {phase.t}.</b> {phase.d}</p>

          <ol className="sm-stops">
            {stops.map((s, i) => (
              <li key={i}>
                <button type="button" onClick={() => jump(i)}
                        className={i === now ? 'sm-stop is-now' : i < now ? 'sm-stop is-done' : now >= 0 && playing ? 'sm-stop is-next' : 'sm-stop'}>
                  <span className="sm-at">{s.at}</span>
                  <span className="sm-what"><b>{PLACES[s.place].name}</b>{s.what}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="sm-ctrl">
            <button type="button" className="sm-btn" disabled={day === 0} onClick={() => pick(day - 1)} aria-label="Предыдущий день">←</button>
            <button type="button" className="sm-btn sm-btn-main" onClick={() => pick(day)}>
              {playing && !all ? 'Идёт…' : 'Пройти день'}
            </button>
            <button type="button" className="sm-btn" disabled={day === DAYS.length - 1} onClick={() => pick(day + 1)} aria-label="Следующий день">→</button>
            <button type="button" className={all ? 'sm-btn sm-btn-all is-on' : 'sm-btn sm-btn-all'}
                    onClick={() => (all ? (stop(), setAll(false)) : wholeShift())}>
              {all ? 'Стоп' : 'Вся смена'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Значки мест: рисуются линией внутри кружка. */
function Icon({ id }: { id: PlaceId }) {
  const common = { fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'houses':
      return <path className="sm-ico" {...common} d="M-7 7V0l7-6 7 6v7zM-2 7V3h4v4" />;
    case 'dining':
      return <path className="sm-ico" {...common} d="M-8 0h16a8 7 0 0 1-16 0zM-3-3c0-2 2-2 2-5M3-3c0-2 2-2 2-5" />;
    case 'meadow':
      return <path className="sm-ico" {...common} d="M-3-2a3 3 0 1 0 6 0a3 3 0 1 0-6 0M0-8v1.5M-6.5-2H-5M5-2h1.5M-4.4-6.4l1 1M4.4-6.4l-1 1M-8 7c3-3 5-3 8 0s5 3 8 0" />;
    case 'studio':
      return <path className="sm-ico" {...common} d="M-7 7l2-6 9-9 4 4-9 9zM-5 1l4 4M2-6l4 4" />;
    case 'stage':
      return <path className="sm-ico" {...common} d="M-3 6a2.6 2.6 0 1 1 0-0.1V-6l8-2v10a2.6 2.6 0 1 1 0-0.1" />;
    case 'fire':
      return <path className="sm-ico" {...common} d="M0-8c5 5 5 9 4 11a4 4 0 0 1-8 0C-5 0-2-2 0-8zM-7 8l14-3M-7 5l14 3" />;
    case 'brook':
    case 'lake':
      return <path className="sm-ico" {...common} d="M-8-3c2-2 4-2 5.3 0s3.4 2 5.3 0 3.4-2 5.4 0M-8 3c2-2 4-2 5.3 0s3.4 2 5.3 0 3.4-2 5.4 0" />;
    case 'forest':
      return <path className="sm-ico" {...common} d="M0-8l6 9H-6zM0 1v7M-4 8h8" />;
    case 'hill':
      return <path className="sm-ico" {...common} d="M0-8l2 4.5 5 .5-3.8 3.3 1.2 4.9L0 2.6-4.4 5.2l1.2-4.9L-7-3l5-.5z" />;
    case 'monastery':
      return <path className="sm-ico" {...common} d="M-6 8V0h12v8M-4 0l4-6 4 6M0-6v-3M-1.5-7.5h3M-1 8V4h2v4" />;
    case 'village':
      return <path className="sm-ico" {...common} d="M-8 7V1l4-4 4 4v6zM1 7V3l3.5-3L8 3v4" />;
    case 'gate':
      return <path className="sm-ico" {...common} d="M-7 8V-4h14V8M-7-4l7-4 7 4M-3 8V0h6v8" />;
  }
}

/** Неподвижная часть карты: горы, лес, вода, ограда лагеря, дорога. */
function Scenery() {
  const trees: Pt[] = [
    [130, 300], [150, 280], [170, 305], [222, 296], [244, 318], [140, 330], [156, 360],
    [236, 360], [222, 386], [170, 392], [120, 372], [260, 340], [106, 330],
    [40, 420], [62, 446], [30, 470], [770, 470], [748, 500], [778, 520],
    [470, 200], [452, 226], [646, 210], [668, 232], [312, 236], [292, 214],
  ];
  const peaks: [number, number, number][] = [
    [40, 110, 60], [250, 92, 76], [330, 112, 56], [420, 86, 80], [520, 104, 64], [600, 92, 58], [770, 104, 66],
  ];
  return (
    <g aria-hidden="true">
      <rect width="800" height="640" fill="#fffaf4" />

      {peaks.map(([x, base, h], i) => (
        <g key={i}>
          <path d={`M${x - h} ${base} L${x} ${base - h} L${x + h} ${base} Z`} fill="#e91e8c" opacity={0.07 + (i % 3) * 0.03} />
          <path d={`M${x - h * 0.24} ${base - h * 0.76} L${x} ${base - h} L${x + h * 0.24} ${base - h * 0.76} L${x + h * 0.08} ${base - h * 0.7} L${x - h * 0.06} ${base - h * 0.78} Z`}
                fill="#fff" />
        </g>
      ))}

      <path d="M150 196 C 172 252, 118 298, 140 352 S 88 440, 108 500 S 62 590, 40 640"
            fill="none" stroke="#cfe2ef" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="140" cy="160" rx="86" ry="38" fill="#e3eef7" stroke="#cfe2ef" strokeWidth="2" />

      <path d="M474 304 Q560 214 646 304 Z" fill="#f9d0e8" opacity="0.55" />

      {trees.map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 13} L${x + 8} ${y + 3} L${x - 8} ${y + 3} Z`}
              fill={i % 4 === 0 ? '#c4107a' : '#9cc3a4'} opacity={i % 4 === 0 ? 0.35 : 0.7} />
      ))}

      {[[686, 362], [738, 360], [694, 414], [744, 410]].map(([x, y], i) => (
        <path key={i} d={`M${x - 8} ${y + 6} V${y - 2} L${x} ${y - 9} L${x + 8} ${y - 2} V${y + 6} Z`}
              fill="#fff" stroke="#1a1a2e" strokeOpacity="0.25" strokeWidth="1.2" />
      ))}

      <rect x="222" y="408" width="436" height="214" rx="30" fill="#e91e8c" fillOpacity="0.035"
            stroke="#e91e8c" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 7" strokeLinecap="round" />
      <text className="sm-area" x="240" y="432">лагерь</text>

      <path d="M672 594 C 720 596, 744 612, 800 614" fill="none" stroke="#1a1a2e" strokeOpacity="0.25"
            strokeWidth="2" strokeDasharray="6 6" />
      <text className="sm-area" x="792" y="590" textAnchor="end">Ереван →</text>

      <g transform="translate(46 262)">
        <circle r="17" fill="#fff" stroke="#1a1a2e" strokeOpacity="0.2" />
        <path d="M0-12 L4 2 L0 0 L-4 2 Z" fill="#e91e8c" />
        <text className="sm-area" y="-21" textAnchor="middle">С</text>
      </g>
    </g>
  );
}
