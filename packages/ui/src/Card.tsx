import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.ts';

export type SkeletonProps = {
  className?: string;
  /** Read by screen readers while loading, e.g. "Loading candidates", from i18n. */
  label?: string;
};

/** A placeholder block in the shape of the coming content; never a spinner over content. */
export function Skeleton({ className, label }: SkeletonProps) {
  return (
    <div
      aria-busy="true"
      className={cx('animate-pulse rounded-control bg-border motion-reduce:animate-none', className)}
    >
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
}

export type CardProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title?: ReactNode;
  /** Replaces the body with a Skeleton until the content is ready. */
  loading?: boolean;
  loadingLabel?: string;
};

export function Card({ title, loading = false, loadingLabel, className, children, ...props }: CardProps) {
  return (
    <div className={cx('rounded-card border border-border bg-surface p-4 shadow-1', className)} {...props}>
      {title && <h3 className="mb-2 text-card text-text">{title}</h3>}
      {loading ? <Skeleton className="h-24" {...(loadingLabel ? { label: loadingLabel } : {})} /> : children}
    </div>
  );
}
