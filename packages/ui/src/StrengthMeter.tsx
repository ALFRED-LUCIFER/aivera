import { cx } from './cx.ts';

export type Strength = 'strong' | 'medium' | 'supporting' | 'claim';

const filled: Record<Strength, number> = { strong: 3, medium: 2, supporting: 1, claim: 0 };

export type StrengthMeterProps = {
  strength: Strength;
  /** The word, e.g. "Strong", from i18n. */
  label: string;
  /** Shown next to a claim only, e.g. "Counts as zero", from i18n (AGENTS.md 1.6). Ignored for other strengths. */
  countsAsZeroLabel?: string;
};

/** Neutral ink only (Foundations artboard .str), so strength is never read as pass or fail. */
export function StrengthMeter({ strength, label, countsAsZeroLabel }: StrengthMeterProps) {
  return (
    <span className="inline-flex items-center gap-2 text-body">
      <span aria-hidden="true" className="inline-flex gap-0.75">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cx('h-2 w-3.5 rounded-xs', i < filled[strength] ? 'bg-text' : 'border border-border-strong')}
          />
        ))}
      </span>
      <span className="font-medium text-text">{label}</span>
      {strength === 'claim' && countsAsZeroLabel && <span className="text-meta text-text-2">{countsAsZeroLabel}</span>}
    </span>
  );
}
