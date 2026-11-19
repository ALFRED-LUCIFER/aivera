import { cx } from './cx.ts';

export type LevelMeterProps = {
  /** The level a job needs, 1 to 5. */
  level: number;
  /** "4 of 5", from i18n. */
  label: string;
};

/** The level a job needs (CHome and CJob artboards .seg): five neutral ink segments, so a need never reads as a grade. */
export function LevelMeter({ level, label }: LevelMeterProps) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {/* Decorative: the words carry the meaning. */}
      <span aria-hidden="true" className="inline-flex gap-0.75">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cx('h-3.5 w-2 rounded-xs', i <= level ? 'bg-text-2' : 'border border-border-strong')}
          />
        ))}
      </span>
      <span className="text-text tabular-nums">{label}</span>
    </span>
  );
}
