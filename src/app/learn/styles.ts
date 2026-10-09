/**
 * Оформление страниц курса. Взято со старой страницы /video, чтобы
 * покупатель видел тот же курс, что и раньше, а не кабинет студии.
 */
export const LEARN_CSS = `
  .lc { line-height: 1.7; min-height: 100dvh; display: flex; flex-direction: column; }
  .lc nav { position: sticky; top: 0; z-index: 100; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 52px; background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(233,30,140,0.12); }
  .lc .nav-logo { font-family: 'Cormorant Garamond', serif; font-size: 17px; color: var(--charcoal); letter-spacing: 0.06em; }
  .lc .nav-logo span { color: var(--rose); }
  .lc .nav-side { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--warm-gray); white-space: nowrap; }
  .lc .nav-side a { color: var(--warm-gray); transition: color 0.2s; }
  .lc .nav-side a:hover { color: var(--rose); }

  .lc .hero { background: var(--charcoal); padding: 90px 64px 72px; position: relative; overflow: hidden; }
  .lc .hero::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 80% 30%, rgba(233,30,140,0.12) 0%, transparent 60%); }
  .lc .hero-inner { max-width: 1100px; margin: 0 auto; position: relative; }
  .lc .hero-label { font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; color: var(--rose-light); margin-bottom: 20px; }
  .lc .hero-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(38px, 4.5vw, 60px); font-weight: 300; line-height: 1.1; color: #fff; margin-bottom: 24px; }
  .lc .hero-title em { font-style: italic; color: var(--rose-light); }
  .lc .hero-desc { font-size: 15px; color: rgba(255,255,255,0.6); line-height: 1.85; max-width: 560px; }
  .lc .hero-until { margin-top: 20px; font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(255,255,255,0.45); }

  .lc .content { max-width: 1100px; width: 100%; margin: 0 auto; padding: 72px 64px; flex: 1; }
  .lc .section-label { font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; color: var(--warm-gray); margin-bottom: 16px; }
  .lc .section-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(30px, 3.5vw, 46px); font-weight: 300; color: var(--charcoal); margin-bottom: 40px; line-height: 1.15; }
  .lc .section-title em { font-style: italic; color: var(--rose); }

  .lc .materials { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding: 28px 32px; margin-bottom: 56px; background: var(--linen); border: 1px solid rgba(200,168,112,0.2); }
  .lc .materials-title { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-weight: 400; margin-bottom: 4px; }
  .lc .materials-sub { font-size: 14px; color: var(--warm-gray); }

  .lc .video-card { border: 1px solid rgba(200,168,112,0.2); margin-bottom: 40px; transition: border-color 0.2s, box-shadow 0.2s; }
  .lc .video-card:hover { border-color: var(--rose-light); box-shadow: 0 4px 32px rgba(233,30,140,0.08); }
  .lc .video-header { display: flex; align-items: center; gap: 20px; padding: 24px 32px; background: var(--linen); border-bottom: 1px solid rgba(200,168,112,0.15); }
  .lc .video-num { font-family: 'Cormorant Garamond', serif; font-size: 42px; font-weight: 300; color: var(--rose-light); line-height: 1; }
  .lc .video-title { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-weight: 400; color: var(--charcoal); }
  .lc .video-player { position: relative; padding-top: 56.25%; background: #000; }
  .lc .video-player iframe { border: 0; position: absolute; inset: 0; height: 100%; width: 100%; }
  .lc .video-desc { padding: 20px 32px; font-size: 14px; color: var(--warm-gray); line-height: 1.85; border-top: 1px solid rgba(200,168,112,0.15); }

  .lc .btn { display: inline-block; padding: 16px 36px; background: var(--rose); color: #fff; border: none; font-family: 'Jost', sans-serif; font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; transition: background 0.2s; text-align: center; }
  .lc .btn:hover { background: var(--rose-dark); }
  .lc .btn:disabled { opacity: 0.6; cursor: default; }

  /* Карточка вместо курса: нет доступа, срок вышел, ссылка устарела. */
  .lc .gate { flex: 1; display: flex; align-items: center; justify-content: center; padding: 64px 20px; background: linear-gradient(135deg, #fce8f0 0%, #f5f0fa 50%, #ede8fa 100%); }
  .lc .gate-card { background: #fff; padding: 52px 48px; max-width: 460px; width: 100%; box-shadow: 0 8px 48px rgba(30,28,26,0.08); text-align: center; }
  .lc .gate-kicker { font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--rose); margin-bottom: 18px; }
  .lc .gate-title { font-family: 'Cormorant Garamond', serif; font-size: 32px; font-weight: 300; line-height: 1.2; margin-bottom: 14px; }
  .lc .gate-text { font-size: 14px; color: var(--warm-gray); line-height: 1.7; margin-bottom: 28px; }
  .lc .gate-text + .gate-text { margin-top: -14px; }
  .lc .gate input { width: 100%; padding: 14px 0; border: none; border-bottom: 1.5px solid rgba(180,160,140,0.4); background: transparent; font-size: 16px; text-align: center; outline: none; transition: border-color 0.3s; }
  .lc .gate input:focus { border-bottom-color: var(--rose); }
  .lc .gate .btn { width: 100%; margin-top: 24px; }
  .lc .gate-note { margin-top: 18px; font-size: 13px; color: var(--warm-gray); line-height: 1.6; }
  .lc .gate-note.err { color: var(--bad); }
  .lc .gate-ok { font-size: 15px; line-height: 1.7; color: var(--charcoal); }

  .lc footer { background: var(--charcoal); padding: 40px 64px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
  .lc .footer-logo { font-family: 'Cormorant Garamond', serif; font-size: 17px; font-weight: 300; color: #fff; }
  .lc .footer-copy { font-size: 11px; color: rgba(255,255,255,0.35); }
  .lc .footer-copy a { color: rgba(255,255,255,0.55); }

  @media (max-width: 860px) {
    .lc nav { padding: 16px 20px; }
    .lc .hero { padding: 56px 20px 48px; }
    .lc .content { padding: 44px 16px; }
    .lc .materials { padding: 22px 20px; }
    .lc .materials .btn { width: 100%; }
    .lc .video-header { padding: 16px 18px; gap: 14px; }
    .lc .video-num { font-size: 34px; }
    .lc .video-title { font-size: 21px; }
    .lc .video-desc { padding: 16px 18px; }
    .lc .gate-card { padding: 40px 24px; }
    .lc footer { padding: 32px 20px; flex-direction: column; align-items: flex-start; }
  }
`;
