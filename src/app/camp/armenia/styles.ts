/**
 * Дополнения к оформлению лагеря для летней смены в Армении. Основа та же,
 * что на /camp (шапка, заголовки, цены, подвал), здесь только то, чего
 * на той странице нет: горы вместо фотографии, смены карточками, распорядок
 * дня, ход смены и вопросы-ответы.
 */
export const ARMENIA_CSS = `
  .lp { --apricot: #f4a259; --apricot-soft: rgba(244,162,89,0.16); }

  .lp .hero-right.art { background: var(--linen); }
  .lp .hero-right.art svg { width: 100%; height: 100%; display: block; }
  .lp .hero-note { font-size: 13px; color: var(--warm-gray); margin-top: 14px; }

  /* Две смены рядом */
  .lp .shifts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 44px; }
  .lp .shift { border: 1px solid var(--line); padding: 34px 30px 30px; background: #fff; position: relative; }
  .lp .shift-n { font-family: 'Cormorant Garamond', serif; font-size: 15px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--rose); margin-bottom: 14px; }
  .lp .shift-dates { font-family: 'Cormorant Garamond', serif; font-size: 34px; font-weight: 300; line-height: 1.1; font-variant-numeric: lining-nums; }
  .lp .shift-facts { list-style: none; margin-top: 22px; border-top: 1px solid var(--line); }
  .lp .shift-facts li { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
  .lp .shift-facts span:first-child { color: var(--warm-gray); }
  .lp .shift-theme { font-size: 14px; color: var(--warm-gray); line-height: 1.8; margin-top: 18px; }

  /* Цитата Вари */
  .lp .quote { font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 300; font-size: clamp(24px, 2.6vw, 34px); line-height: 1.35; color: var(--charcoal); max-width: 760px; margin: 48px 0 0; padding-left: 28px; border-left: 2px solid var(--rose); }
  .lp .quote cite { display: block; font-family: 'Jost', sans-serif; font-style: normal; font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--warm-gray); margin-top: 14px; }

  /* Мастерские: сетка карточек с номерами */
  .lp .crafts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px 40px; margin-top: 48px; }
  .lp .craft-n { font-family: 'Cormorant Garamond', serif; font-size: 15px; color: var(--rose); font-variant-numeric: lining-nums; margin-bottom: 6px; }
  .lp .craft-t { font-family: 'Cormorant Garamond', serif; font-size: 23px; line-height: 1.2; margin-bottom: 8px; }
  .lp .craft-d { font-size: 14px; color: var(--warm-gray); line-height: 1.85; }

  /* Подзаголовок внутри секции */
  .lp .h3 { font-family: 'Cormorant Garamond', serif; font-size: 26px; font-weight: 400; margin: 64px 0 0; }
  .lp .h3 em { font-style: italic; color: var(--rose); }

  /* Распорядок дня */
  .lp .sched { margin-top: 44px; border-top: 1px solid var(--line); }
  .lp .sched-row { display: grid; grid-template-columns: 110px 1fr; gap: 24px; padding: 16px 0; border-bottom: 1px solid var(--line); align-items: baseline; }
  .lp .sched-time { font-size: 14px; letter-spacing: 0.08em; color: var(--rose); font-variant-numeric: tabular-nums; }
  .lp .sched-what { font-size: 15px; color: var(--charcoal); }
  .lp .sched-what span { display: block; font-size: 13px; color: var(--warm-gray); margin-top: 2px; }

  /* Ход смены: от первого дня к последнему */
  .lp .arc { list-style: none; margin-top: 44px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-top: 2px solid var(--rose-light); }
  .lp .arc li { padding: 26px 22px 0 0; position: relative; }
  .lp .arc li::before { content: ''; position: absolute; top: -7px; left: 0; width: 12px; height: 12px; border-radius: 50%; background: var(--rose); }
  .lp .arc li:last-child::before { background: var(--apricot); }
  .lp .arc-when { font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--warm-gray); margin-bottom: 8px; }
  .lp .arc-t { font-family: 'Cormorant Garamond', serif; font-size: 22px; line-height: 1.2; margin-bottom: 8px; }
  .lp .arc-d { font-size: 14px; color: var(--warm-gray); line-height: 1.8; }

  /* Про Варю: фото слева, текст справа */
  .lp .host { display: grid; grid-template-columns: 5fr 6fr; gap: 64px; align-items: center; }
  .lp .host img { width: 100%; aspect-ratio: 4/5; object-fit: cover; object-position: 45% 30%; display: block; }
  .lp .host-list { list-style: none; margin-top: 26px; border-top: 1px solid var(--line); }
  .lp .host-list li { padding: 12px 0; border-bottom: 1px solid var(--line); font-size: 14px; color: var(--warm-gray); line-height: 1.7; }
  .lp .host-list b { font-weight: 400; color: var(--charcoal); }

  /* Полоса фото: шесть кадров */
  .lp .shots-6 { grid-template-columns: repeat(3, 1fr); }
  .lp .shots-6 img { aspect-ratio: 4/3; }

  /* Вопросы и ответы без скриптов: details/summary */
  .lp .faq { margin-top: 40px; border-top: 1px solid var(--line); }
  .lp .faq details { border-bottom: 1px solid var(--line); }
  .lp .faq summary { list-style: none; cursor: pointer; padding: 20px 40px 20px 0; position: relative; font-family: 'Cormorant Garamond', serif; font-size: 21px; line-height: 1.3; }
  .lp .faq summary::-webkit-details-marker { display: none; }
  .lp .faq summary::after { content: '+'; position: absolute; right: 4px; top: 16px; font-family: 'Jost', sans-serif; font-weight: 300; font-size: 24px; color: var(--rose); transition: transform 0.2s; }
  .lp .faq details[open] summary::after { transform: rotate(45deg); }
  .lp .faq p { font-size: 14px; color: var(--warm-gray); line-height: 1.85; padding: 0 0 22px; max-width: 700px; }

  /* Что входит в цену */
  .lp .incl { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 44px; }
  .lp .incl-box { border: 1px solid var(--line); background: #fff; padding: 30px 30px 26px; }
  .lp .incl-box ul { list-style: none; }
  .lp .incl-box li { font-size: 14px; color: var(--charcoal); padding: 8px 0 8px 24px; position: relative; line-height: 1.6; }
  .lp .incl-box li::before { content: ''; position: absolute; left: 2px; top: 16px; width: 10px; height: 1.5px; background: var(--rose); }
  .lp .incl-off li { color: var(--warm-gray); }
  .lp .incl-off li::before { background: var(--warm-gray); }
  .lp .incl-cols { columns: 2; column-gap: 32px; }
  .lp .incl-cols li { break-inside: avoid; }

  /* Последний экран: заявка на тёмном */
  .lp .apply { background: var(--charcoal); color: #fff; max-width: none; }
  .lp .apply .inner { max-width: 1020px; margin: 0 auto; }
  .lp .apply .eyebrow { color: rgba(255,255,255,0.55); }
  .lp .apply .h2 { color: #fff; }
  .lp .apply .h2 em { color: var(--rose-light); }
  .lp .apply .lead { color: rgba(255,255,255,0.72); }
  .lp .apply .cta { background: var(--rose); }
  .lp .apply .cta:hover { background: var(--rose-dark); }
  .lp .apply .mail { color: var(--rose-light); }
  .lp .apply-ask { list-style: none; margin-top: 26px; display: flex; flex-wrap: wrap; gap: 8px; }
  .lp .apply-ask li { font-size: 12px; letter-spacing: 0.06em; border: 1px solid rgba(255,255,255,0.22); color: rgba(255,255,255,0.8); padding: 7px 14px; }
  .lp .apply + footer { border-top: 1px solid rgba(255,255,255,0.08); }

  @media (max-width: 900px) {
    .lp .shifts, .lp .incl, .lp .host { grid-template-columns: 1fr; }
    .lp .host { gap: 32px; }
    .lp .host img { aspect-ratio: 1/1; }
    .lp .crafts { grid-template-columns: 1fr; gap: 28px; }
    .lp .arc { grid-template-columns: 1fr; border-top: none; border-left: 2px solid var(--rose-light); margin-left: 6px; }
    .lp .arc li { padding: 0 0 28px 26px; }
    .lp .arc li::before { top: 6px; left: -7px; }
    .lp .sched-row { grid-template-columns: 64px 1fr; gap: 14px; }
    .lp .shots-6 { grid-template-columns: 1fr 1fr; }
    .lp .incl-cols { columns: 1; }
    .lp .shift-dates { font-size: 30px; }
    .lp .quote { padding-left: 20px; }
  }
`;
