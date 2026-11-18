import type { ReactNode } from 'react';

export type PageHeaderProps = {
  /** "Jobs / Senior AI Engineer": the page passes its own breadcrumb nav. */
  breadcrumb?: ReactNode;
  title: ReactNode;
  /** The page's buttons; one primary at most (DESIGN.md). */
  actions?: ReactNode;
};

export function PageHeader({ breadcrumb, title, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-2.5">
      {breadcrumb}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-title tracking-tight">{title}</h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
