import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx.ts';

export type SkeletonProps = {
  /** Sets the placeholder's shape (height, width); layout only. */
  className?: string;
};

/**
 * A decorative placeholder in the shape of the coming content; never a spinner over content.
 * Put it inside a region with aria-busy="true" and announce loading in a sibling role="status" (an <output>), as Card does.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-control bg-border motion-reduce:animate-none', className)}
    />
  );
}

export type CardProps = Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode;
  /** Heading level of the title; DESIGN.md card titles are h3. */
  level?: 2 | 3 | 4;
  /** Replaces the body with a Skeleton until the content is ready. */
  loading?: boolean;
  /** Announced while loading, e.g. "Loading evidence", from i18n. */
  loadingLabel?: string;
};

/** `className` is for layout (margin, width, grid placement), not for overriding padding or colour. */
export function Card({ title, level = 3, loading = false, loadingLabel, className, children, ...props }: CardProps) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('rounded-card border border-border bg-surface p-4 shadow-1', className)} {...props}>
      {title && <Heading className="mb-2 text-card text-text">{title}</Heading>}
      {/* The status stays mounted so a change of its text is announced; the busy region holds the content. */}
      {loadingLabel && <output className="sr-only">{loading ? loadingLabel : ''}</output>}
      <div aria-busy={loading || undefined}>{loading ? <Skeleton className="h-24" /> : children}</div>
    </div>
  );
}
