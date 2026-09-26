import { connectTelegram } from '@/app/account/actions';

/**
 * Куда писать студии. До сих пор в кабинете не было ни одного адреса, и
 * родитель искал Варю по прошлым перепискам — или писал боту, а тот
 * отвечал расписанием и сообщение выбрасывал.
 *
 * Бот и есть канал: он передаёт сообщение в студию и приносит ответ
 * обратно. Кто его не подключил, пишет письмом — почта есть у всех.
 */
export default function ContactCard({ chat }: { chat: boolean }) {
  const bot = process.env.TELEGRAM_BOT_NAME?.replace(/^@/, '') ?? null;

  return (
    <div className="card-lin" style={{ marginTop: 18 }}>
      <div className="what" style={{ marginBottom: 6 }}>Написать студии</div>

      {chat ? (
        <>
          <p className="sub">
            Напишите боту — сообщение уйдёт в студию, ответ придёт туда же.
            Заболели, опаздываете, что-то нужно к занятию: всё сюда.
          </p>
          {bot && (
            <a className="btn" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer"
               style={{ marginTop: 14 }}>
              Открыть чат с ботом
            </a>
          )}
        </>
      ) : (
        <>
          <p className="sub">
            Проще всего через телеграм: подключите бота, и можно писать прямо
            ему — сообщение уйдёт в студию, ответ придёт туда же.
          </p>
          <form action={connectTelegram} style={{ marginTop: 14 }}>
            <button className="btn" type="submit">Подключить телеграм</button>
          </form>
        </>
      )}

      <p className="hint" style={{ marginTop: 14 }}>
        Или письмом: <a href="mailto:info@re-create.art">info@re-create.art</a>.
        Постараемся ответить в течение дня.
      </p>
    </div>
  );
}
