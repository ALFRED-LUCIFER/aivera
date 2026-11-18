import type { ReactNode } from 'react';

/** A screenshot and axe unit: tests find each section by its id. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-card bg-bg p-4">
      <h2 id={`${id}-title`} className="font-display text-section text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function State({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-meta font-semibold text-text-2">{title}</h3>
      {children}
    </div>
  );
}
