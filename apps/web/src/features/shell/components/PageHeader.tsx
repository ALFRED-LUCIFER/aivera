import type { ReactNode } from 'react';

export type PageHeaderProps = {
  /** "Jobs / Senior AI Engineer": the page passes its own breadcrumb nav. */
  breadcrumb?: ReactNode;
  title: ReactNode;
  /** A line under the title: what the page is for, or the record's tags. */
  description?: ReactNode;
  /** The page's buttons; one primary at most (DESIGN.md). */
  actions?: ReactNode;
};

export function PageHeader({ breadcrumb, title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-2.5">
      {breadcrumb}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-display text-title tracking-tight">{title}</h1>
          {description && <div className="max-w-prose text-body text-text-2">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
