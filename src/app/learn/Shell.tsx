import { LEARN_CSS } from './styles';

/** Шапка и подвал страниц курса. Справа в шапке — то, что уместно на этой странице. */
export default function Shell({ side, children }: { side?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="lc">
      <style dangerouslySetInnerHTML={{ __html: LEARN_CSS }} />
      <nav>
        <a href="/" className="nav-logo">Re.Create.Art · <span>Варя Перлина</span></a>
        {side && <div className="nav-side">{side}</div>}
      </nav>
      {children}
      <footer>
        <div className="footer-logo">Re.Create.Art · Варя Перлина</div>
        <div className="footer-copy">
          Вопросы: <a href="mailto:info@re-create.art">info@re-create.art</a>
        </div>
      </footer>
    </div>
  );
}
