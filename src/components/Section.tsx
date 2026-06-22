import { useState, type ReactNode } from 'react';

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

export default function Section({ title, defaultOpen = true, badge, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <button className="section-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`chevron ${open ? 'open' : ''}`} aria-hidden>
          ▸
        </span>
        <span className="section-title">{title}</span>
        {badge != null && <span className="section-badge">{badge}</span>}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
