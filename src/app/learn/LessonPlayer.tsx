'use client';

import { useEffect, useRef, useState } from 'react';

type Stream = { src: string; poster: string };
type HlsLike = { destroy(): void; startLoad(): void; recoverMediaError(): void };

/**
 * Свой плеер урока. Видео берётся прямо из зоны CDN Bunny по подписанной
 * ссылке, без плеера Bunny: тот общий для всех и из России ведёт на дальний
 * сервер, до которого у части провайдеров запросы обрываются.
 *
 * До нажатия грузится только обложка: уроков на странице четыре, и тянуть
 * все сразу незачем. Играет hls.js, старым айфонам — их собственный HLS.
 *
 * Зона Bunny пускает только с Referer re-create.art: с localhost видео
 * не пойдёт, проверять это можно только на боевом сайте.
 * Если свой плеер не справился, под рукой плеер Bunny.
 */
export default function LessonPlayer({
  title, stream, embed,
}: { title: string; stream: Stream | null; embed: string | null }) {
  const [mode, setMode] = useState<'own' | 'bunny'>(stream ? 'own' : 'bunny');
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsLike | null>(null);
  // Модуль грузим заранее, чтобы нажатие сразу запускало видео: после
  // долгого ожидания браузер может уже не считать play() ответом на клик.
  const lib = useRef<Promise<typeof import('hls.js')> | null>(null);

  useEffect(() => {
    if (stream) lib.current = import('hls.js');
    return () => hls.current?.destroy();
  }, [stream]);

  async function start() {
    const el = video.current;
    if (!el || !stream) return;
    setStarted(true);
    setFailed(false);

    const { default: Hls } = await (lib.current ?? import('hls.js'));
    // hls.js — везде, где он работает: так видны ошибки и есть повтор.
    // Свой HLS у браузера — только запасной путь для старых айфонов: Chrome
    // тоже теперь говорит, что умеет HLS, но при сбое молчит.
    if (!Hls.isSupported()) {
      if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = stream.src;
        el.addEventListener('error', () => setFailed(true), { once: true });
        el.play().catch(() => {});
      } else {
        setFailed(true);
      }
      return;
    }
    const player = new Hls({ capLevelToPlayerSize: true });
    hls.current = player;
    let retried = false;
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // Один раз пробуем подняться сами: сеть моргнула или кусок не
      // декодировался. Второй раз — честно говорим и даём другой плеер.
      if (!retried && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        retried = true;
        player.startLoad();
      } else if (!retried && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        retried = true;
        player.recoverMediaError();
      } else {
        player.destroy();
        hls.current = null;
        setFailed(true);
      }
    });
    player.loadSource(stream.src);
    player.attachMedia(el);
    el.play().catch(() => {});
  }

  function switchTo(next: 'own' | 'bunny') {
    hls.current?.destroy();
    hls.current = null;
    setStarted(false);
    setFailed(false);
    setMode(next);
  }

  return (
    <>
      <div className="video-player">
        {mode === 'bunny' && embed ? (
          <iframe
            src={embed}
            title={title}
            loading="lazy"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : stream ? (
          <>
            <video
              ref={video}
              poster={stream.poster}
              controls={started}
              playsInline
              preload="none"
              aria-label={title}
            />
            {!started && (
              <button type="button" className="play-btn" onClick={start} aria-label={`Смотреть: ${title}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </button>
            )}
            {failed && (
              <div className="player-fail">
                <p>Видео не загрузилось.</p>
                {embed && (
                  <button type="button" className="btn" onClick={() => switchTo('bunny')}>
                    Открыть в другом плеере
                  </button>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
      {stream && embed && (
        <div className="player-alt">
          {mode === 'own' ? (
            <button type="button" onClick={() => switchTo('bunny')}>Не грузится? Другой плеер</button>
          ) : (
            <button type="button" onClick={() => switchTo('own')}>Вернуться к основному плееру</button>
          )}
        </div>
      )}
    </>
  );
}
