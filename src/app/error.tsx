'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app">
      <div className="top">
        <div className="kicker">Re.Create.Art</div>
        <h1 className="h1">Что-то сломалось</h1>
      </div>
      <div className="body">
        <p className="hint">
          Страница не открылась из-за ошибки на сервере. Попробуйте ещё раз, а если
          повторится — напишите на <a href="mailto:info@re-create.art">info@re-create.art</a>.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn" type="button" onClick={reset}>Ещё раз</button>
          <a className="btn-quiet" href="/">На главную</a>
        </div>
      </div>
    </main>
  );
}
