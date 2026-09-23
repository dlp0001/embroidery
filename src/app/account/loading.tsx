/**
 * Что видно, пока страница кабинета собирается на сервере. Закладки и
 * шапка при этом остаются на месте: переключение отзывается сразу, а не
 * через полсекунды тишины.
 */
export default function Loading() {
  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <div className="skel" style={{ width: 160, height: 30, marginTop: 4 }} />
      </div>
      <div className="body">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skel"
               style={{ height: 52, marginBottom: 10, opacity: 1 - i * 0.2 }} />
        ))}
      </div>
    </>
  );
}
