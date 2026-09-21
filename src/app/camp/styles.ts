/**
 * Оформление публичной страницы лагеря. Оно же на /studio и на других
 * страницах сайта: те живут статикой в public/legacy, а эта собирается
 * из базы, поэтому стили лежат здесь отдельной строкой.
 */
export const CAMP_CSS = `
  .lp { --line: rgba(233,30,140,0.14); line-height: 1.7; }
  .lp *, .lp *::before, .lp *::after { box-sizing: border-box; margin: 0; padding: 0; }
  .lp nav { position: sticky; top: 0; z-index: 100; display: flex; justify-content: space-between; align-items: center; padding: 18px 52px; min-height: 72px; background: rgba(255,255,255,0.97); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(233,30,140,0.08); }
  .lp .nav-logo { font-family: 'Cormorant Garamond', serif; font-size: 17px; color: var(--charcoal); letter-spacing: 0.06em; text-decoration: none; }
  .lp .nav-logo span { color: var(--rose); }
  .lp .nav-back { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--warm-gray); text-decoration: none; white-space: nowrap; transition: color 0.2s; }
  .lp .nav-back:hover { color: var(--rose); }
  .lp .nav-side { display: flex; align-items: center; gap: 20px; }
  .lp .nav-cta { font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; padding: 9px 24px; background: var(--rose); color: #fff; text-decoration: none; transition: background 0.2s; }
  .lp .nav-cta:hover { background: var(--rose-dark); }

  .lp .hero { display: grid; grid-template-columns: 1fr 1fr; min-height: 520px; }
  .lp .hero-left { padding: 90px 64px; display: flex; flex-direction: column; justify-content: center; }
  .lp .hero-pretitle { font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; color: var(--warm-gray); margin-bottom: 28px; }
  .lp .hero-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(40px, 4.6vw, 64px); font-weight: 300; line-height: 1.05; color: var(--charcoal); }
  .lp .hero-title-italic { font-family: 'Cormorant Garamond', serif; font-size: clamp(40px, 4.6vw, 64px); font-weight: 300; font-style: italic; line-height: 1.05; color: var(--rose); margin-bottom: 32px; }
  .lp .hero-desc { font-size: 15px; color: var(--warm-gray); max-width: 450px; line-height: 1.9; }
  .lp .hero-cta { align-self: flex-start; margin-top: 34px; padding: 16px 40px; background: var(--charcoal); color: #fff; text-decoration: none; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; transition: background 0.3s; }
  .lp .hero-cta:hover { background: var(--rose); }
  .lp .hero-right { position: relative; overflow: hidden; }
  .lp .hero-right img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .lp .wrap { max-width: 1020px; margin: 0 auto; padding: 88px 64px; }
  .lp .wrap-tint { background: var(--linen); max-width: none; }
  .lp .wrap-tint > .inner { max-width: 1020px; margin: 0 auto; }
  .lp .eyebrow { font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; color: var(--warm-gray); margin-bottom: 18px; }
  .lp .h2, .lp .price-sum, .lp .sked-days { font-variant-numeric: lining-nums; font-feature-settings: 'lnum' 1; }
  .lp .h2 { font-family: 'Cormorant Garamond', serif; font-size: clamp(28px, 3.2vw, 42px); font-weight: 300; line-height: 1.15; margin-bottom: 18px; }
  .lp .h2 em { font-style: italic; color: var(--rose); }
  .lp .lead { font-size: 15px; color: var(--warm-gray); line-height: 1.9; max-width: 620px; }

  .lp .sked { margin-top: 44px; border-top: 1px solid var(--line); }
  .lp .sked-row { display: grid; grid-template-columns: 190px 120px 1fr; gap: 24px; align-items: baseline; padding: 26px 0; border-bottom: 1px solid var(--line); }
  .lp .sked-days { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-weight: 400; color: var(--charcoal); }
  .lp .sked-time { font-size: 15px; letter-spacing: 0.08em; color: var(--rose); }
  .lp .sked-what { font-size: 15px; color: var(--charcoal); }
  .lp .sked-note { display: block; font-size: 13px; color: var(--warm-gray); margin-top: 4px; }
  .lp .sked-tag { display: inline-block; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--rose-dark); border: 1px solid var(--rose-light); padding: 3px 10px; margin-left: 10px; vertical-align: middle; }
  .lp .after { font-size: 14px; color: var(--warm-gray); margin-top: 28px; }

  /* Программа по дням */
  .lp .prog { margin-top: 40px; border-top: 1px solid var(--line); }
  .lp .prog-row { display: grid; grid-template-columns: 150px 1fr auto; gap: 24px; align-items: center; padding: 20px 0; border-bottom: 1px solid var(--line); }
  .lp .prog-day { font-family: 'Cormorant Garamond', serif; font-size: 23px; font-variant-numeric: lining-nums; }
  .lp .prog-dow { display: block; font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--warm-gray); margin-bottom: 2px; }
  .lp .prog-what { font-size: 14px; color: var(--warm-gray); line-height: 1.75; }
  .lp .prog-soon { color: rgba(26,26,46,0.32); }
  .lp .prog-act { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
  .lp .prog-seats { font-size: 11px; color: var(--warm-gray); white-space: nowrap; }
  .lp .kid { font-size: 11px; letter-spacing: 0.04em; padding: 9px 14px; cursor: pointer; border: 1px solid rgba(26,26,46,0.15); background: #fff; color: var(--charcoal); }
  .lp .kid:hover { border-color: var(--rose-light); }
  .lp .kid-on { border-color: var(--rose); background: rgba(233,30,140,0.07); font-weight: 500; }
  .lp .kid[disabled] { opacity: 0.45; cursor: default; }
  .lp .prog-cta { font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; padding: 10px 22px; background: var(--charcoal); color: #fff; text-decoration: none; white-space: nowrap; }
  .lp .prog-cta:hover { background: var(--rose); }

  .lp .prices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 44px; }
  .lp .price { background: #fff; border: 1px solid var(--line); padding: 32px 28px; display: flex; flex-direction: column; }
  .lp .price-kind { font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--warm-gray); margin-bottom: 20px; }
  .lp .price-sum { font-family: 'Cormorant Garamond', serif; font-size: 46px; font-weight: 300; line-height: 1; color: var(--charcoal); }
  .lp .price-sum span { font-size: 22px; color: var(--warm-gray); }
  .lp .price-per { font-size: 13px; color: var(--rose); margin-top: 12px; }
  .lp .price-desc { font-size: 14px; color: var(--warm-gray); line-height: 1.8; margin-top: 16px; }

  .lp .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 48px; margin-top: 44px; }
  .lp .rule { border-top: 1px solid var(--line); padding-top: 22px; }
  .lp .rule-t { font-family: 'Cormorant Garamond', serif; font-size: 21px; margin-bottom: 8px; }
  .lp .rule-d { font-size: 14px; color: var(--warm-gray); line-height: 1.85; }

  .lp .split { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 0; }
  .lp .split img { width: 100%; height: 100%; max-height: 620px; object-fit: cover; display: block; }
  .lp .split-text { padding: 88px 64px; }

  .lp .cta { display: inline-block; margin-top: 32px; padding: 16px 48px; background: var(--charcoal); color: #fff; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; text-decoration: none; transition: background 0.3s; }
  .lp .cta:hover { background: var(--rose); }
  .lp .mail { color: var(--rose); text-decoration: none; }
  .lp .mail:hover { text-decoration: underline; }

  .lp footer { background: var(--charcoal); padding: 40px 64px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; }
  .lp .footer-logo { font-family: 'Cormorant Garamond', serif; font-size: 19px; font-weight: 300; color: #fff; }
  .lp .footer-links { display: flex; gap: 24px; flex-wrap: wrap; }
  .lp .footer-links a { font-size: 12px; color: rgba(250,247,242,0.5); text-decoration: none; transition: color 0.2s; }
  .lp .footer-links a:hover { color: var(--rose-light); }

  @media (max-width: 360px) {
    .lp nav { padding: 12px 12px; }
    .lp .nav-cta { padding: 9px 12px; font-size: 9px; letter-spacing: 0.1em; }
    .lp .nav-side { gap: 6px; }
  }
  @media (max-width: 900px) {
    .lp nav { padding: 11px 16px; min-height: 56px; }
    .lp .nav-logo { font-size: 15px; }
    .lp .nav-side { gap: 10px; }
    .lp .nav-back { letter-spacing: 0; font-size: 17px; line-height: 1; padding: 0 8px; display: flex; align-items: center; min-height: 32px; }
    .lp .nav-word { display: none; }
    .lp .hero-pretitle { letter-spacing: 0.2em; }
    .lp .nav-cta { padding: 0 16px; letter-spacing: 0.15em; display: inline-flex; align-items: center; min-height: 32px; }
    .lp .hero { grid-template-columns: 1fr; }
    .lp .hero-left { padding: 56px 28px; }
    .lp .hero-cta { align-self: stretch; text-align: center; padding: 16px 24px; }
    .lp .hero-right { height: 320px; }
    .lp .wrap, .lp .split-text { padding: 60px 28px; }
    .lp .sked-row { grid-template-columns: 1fr; gap: 4px; padding: 22px 0; }
    .lp .sked-days { font-size: 21px; }
    .lp .prog-row { grid-template-columns: 1fr; gap: 10px; padding: 18px 0; }
    .lp .prog-act { justify-content: flex-start; }
    .lp .prices { grid-template-columns: 1fr; }
    .lp .rules { grid-template-columns: 1fr; gap: 4px 0; }
    .lp .split { grid-template-columns: 1fr; }
    .lp .split img { max-height: 380px; }
    .lp footer { padding: 32px 28px; }
  }
`;
