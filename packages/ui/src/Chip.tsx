import type { ReactNode } from 'react';
import { cx } from './cx.ts';

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'err' | 'info';

const tones: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface-subtle text-text-2',
  ok: 'border-ok-border bg-ok-bg text-ok-text',
  warn: 'border-warn-border bg-warn-bg text-warn-text',
  err: 'border-err-border bg-err-bg text-err-text',
  info: 'border-info-border bg-info-bg text-info-text',
};

export type ChipProps = {
  children: ReactNode;
  tone?: ChipTone;
  /** A decorative icon before the word; the word carries the meaning. */
  icon?: ReactNode;
  /** For layout (margin, grid placement), not for size or colour. */
  className?: string | undefined;
};

/** A pill for a flag ("Applied to 5 roles", "2 duplicates merged"). DESIGN.md: 26 px high, pill radius. */
export function Chip({ children, tone = 'neutral', icon, className }: ChipProps) {
  return (
    <span
      className={cx(
        // min-h and max-w-full: a long flag wraps inside a narrow cell instead of overflowing it.
        'inline-flex min-h-6.5 max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-meta font-semibold',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export type StatusBadgeStatus = 'supported' | 'needsValidation' | 'contradiction' | 'informational';

const glyph = (path: string) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className="size-3.5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
  >
    <path d={path} />
  </svg>
);

// DESIGN.md status chip: Supported (ok), Needs validation (warn), Contradiction (err), Informational (info).
const statuses: Record<StatusBadgeStatus, { tone: ChipTone; icon: ReactNode }> = {
  supported: { tone: 'ok', icon: glyph('m3.5 8.5 3 3 6-7') },
  needsValidation: { tone: 'warn', icon: glyph('M8 2.5 14 13H2zM8 6.5v3m0 1.75v.25') },
  contradiction: { tone: 'err', icon: glyph('m4.5 4.5 7 7m0-7-7 7') },
  informational: { tone: 'info', icon: glyph('M8 7v4.5M8 4.5v.25M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0') },
};

export type StatusBadgeProps = {
  status: StatusBadgeStatus;
  /** The word, from i18n, e.g. "Needs validation". Always shown: colour never carries the status alone. */
  label: string;
  className?: string;
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const { tone, icon } = statuses[status];
  return (
    <Chip tone={tone} icon={icon} className={className}>
      {label}
    </Chip>
  );
}
