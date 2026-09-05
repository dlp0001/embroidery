/** Студия без базы работать не может: показываем это словами, а не стектрейсом. */
export default function NotConfigured() {
  return (
    <main className="app">
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Раздел ещё не подключён</h1>
      </div>
      <div className="body">
        <p className="hint">
          Кабинет студии и журнал занятий появятся, когда будет подключена база.
          Курс по вышивке работает как обычно.
        </p>
        <p className="hint" style={{ marginTop: 16 }}>
          <a href="/">На главную</a>
        </p>
      </div>
    </main>
  );
}
