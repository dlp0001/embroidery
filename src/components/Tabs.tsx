'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONS: Record<string, React.ReactNode> = {
  week: <path d="M4 6h16M4 12h16M4 18h10" />,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  hist: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pay: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  groups: <><circle cx="9" cy="8" r="3.2" /><path d="M2.8 20c0-3.4 2.8-6.2 6.2-6.2s6.2 2.8 6.2 6.2" /><circle cx="17.6" cy="9" r="2.4" /><path d="M17.6 13.6c2.2 0 3.8 1.8 3.8 4" /></>,
};

export type Tab = { href: string; icon: string; label: string };

export default function Tabs({ tabs }: { tabs: Tab[] }) {
  const path = usePathname();
  return (
    <nav className="tabs" style={{ ['--tabs' as string]: tabs.length }}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="tab" data-on={path === t.href ? '1' : '0'}>
          <svg viewBox="0 0 24 24">{ICONS[t.icon]}</svg>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
