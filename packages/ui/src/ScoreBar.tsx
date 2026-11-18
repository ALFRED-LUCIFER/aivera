import { cx } from './cx.ts';

// Foundations and Candidate artboards .score/.hatch. Solid to the proven value, hatched over the range resting on
// claims (AGENTS.md 1.6: claims count zero, so the hatched range is never the score). Values arrive as props; scoring
// lives in @aivera/assessment, so nothing here computes a score.

/** A wrong number must never reach a recruiter: loud in development, a plain "unavailable" in production. */
function refuse(component: string, unavailableLabel: string) {
  // Numbers stay out of the message: scores are candidate data (AGENTS.md 1.2).
  if (process.env['NODE_ENV'] !== 'production') throw new Error(`${component}: values out of range`);
  return <span className="text-meta text-text-2">{unavailableLabel}</span>;
}

/** Percentages of the track. The need mark is an upright tick; see styles.css for the forced-colours fallback. */
function Track({ solid, upTo, mark }: { solid: number; upTo: number; mark?: number }) {
  return (
    <span className="relative block h-2.5 min-w-22 flex-1 rounded-full bg-surface-subtle inset-ring inset-ring-border">
      <span className="score-solid absolute inset-y-0 start-0 rounded-full" style={{ width: `${solid}%` }} />
      {upTo > solid && (
        <span
          data-part="claimed"
          className="score-hatch absolute inset-y-0 rounded-e-full"
          style={{ insetInlineStart: `${solid}%`, width: `${upTo - solid}%` }}
        />
      )}
      {mark !== undefined && (
        <span
          data-part="need"
          className="score-solid absolute -top-1.25 h-5 w-0.75 -translate-x-1/2 rounded-xs ring-2 ring-surface rtl:translate-x-1/2"
          style={{ insetInlineStart: `${mark}%` }}
        />
      )}
    </span>
  );
}

export type ScoreWithUncertaintyProps = {
  /** The backed score, 0 to 100. Claims count zero in it. */
  backed: number;
  /** The ceiling if every open claim holds, backed to 100. */
  upTo: number;
  /** "62 backed by evidence", from i18n. */
  backedLabel: (backed: number) => string;
  /** "up to 78 if claims hold in interview" (compact: "up to 84 if claims hold"), from i18n. */
  upToLabel: (upTo: number) => string;
  /** "Score unavailable", shown in production when the values are inconsistent. */
  unavailableLabel: string;
  /** Table cell: the number, the bar and the "up to" text only. */
  compact?: boolean;
};

export function ScoreWithUncertainty({
  backed,
  upTo,
  backedLabel,
  upToLabel,
  unavailableLabel,
  compact,
}: ScoreWithUncertaintyProps) {
  // Written so NaN fails too.
  if (!(backed >= 0 && backed <= upTo && upTo <= 100)) return refuse('ScoreWithUncertainty', unavailableLabel);
  const open = upTo > backed;
  // The middle dot is DESIGN.md's list separator in every language Aivera ships.
  const caption = open ? `${backedLabel(backed)} · ${upToLabel(upTo)}` : backedLabel(backed);
  return (
    // role="img" makes the children presentational, so the caption is read once, as the accessible name.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a CSS-drawn bar, not an image file; ARIA img names it
    <span role="img" aria-label={caption} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body">
      {compact && <span className="font-semibold text-text tabular-nums">{backed}</span>}
      <Track solid={backed} upTo={upTo} />
      {compact ? (
        open && <span className="text-meta text-text-2 tabular-nums">{upToLabel(upTo)}</span>
      ) : (
        <span className="text-meta text-text-2 tabular-nums">{caption}</span>
      )}
    </span>
  );
}

/** Rubric levels run 0 to 5. */
const LEVELS = 5;

export type NeedVsProvenBarProps = {
  /** The competency, e.g. "Cost and reliability". */
  name: string;
  /** Level backed by evidence, 0 to claimed. */
  proven: number;
  /** Level the candidate claims, proven to 5. */
  claimed: number;
  /** Level the job needs, from the rubric. */
  needed: number;
  /** "Proven 1 of 5 · job needs 2", from i18n. */
  levelLabel: (proven: number, levels: number, needed: number) => string;
  /** Text equivalent of the bar: "Proven 1 of 5, claimed 4, the job needs 2", from i18n. */
  barLabel: (proven: number, claimed: number, needed: number, levels: number) => string;
  aboveLabel: string;
  meetsLabel: string;
  /** "1 short, claimed" when claims reach the need, "1 short" when they do not, from i18n. */
  shortLabel: (short: number, claimed: boolean) => string;
  unavailableLabel: string;
};

const check = <path d="m5 12.5 4.5 4.5L19 7.5" />;
// Same clock as ProvenanceTag's "claim": the gap rests on a claim awaiting validation.
const clock = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>
);
const gap = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 12h8" />
  </>
);

export function NeedVsProvenBar(p: NeedVsProvenBarProps) {
  const { proven, claimed, needed } = p;
  const level = (n: number) => Number.isInteger(n) && n >= 0 && n <= LEVELS;
  if (!(level(proven) && level(claimed) && level(needed) && proven <= claimed)) {
    return refuse('NeedVsProvenBar', p.unavailableLabel);
  }
  const short = needed - proven;
  const outcome =
    short < 0
      ? { ok: true, icon: check, label: p.aboveLabel }
      : short === 0
        ? { ok: true, icon: check, label: p.meetsLabel }
        : claimed >= needed
          ? { ok: false, icon: clock, label: p.shortLabel(short, true) }
          : { ok: false, icon: gap, label: p.shortLabel(short, false) };
  const pct = (n: number) => (n / LEVELS) * 100;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 py-3 text-body">
      <span className="min-w-0 flex-1 basis-40 font-medium text-text">
        {p.name}
        <span className="block text-meta font-normal text-text-2 tabular-nums">
          {p.levelLabel(proven, LEVELS, needed)}
        </span>
      </span>
      <span
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a CSS-drawn bar, not an image file; ARIA img names it
        role="img"
        aria-label={p.barLabel(proven, claimed, needed, LEVELS)}
        className="flex min-w-22 flex-1 basis-22"
      >
        <Track solid={pct(proven)} upTo={pct(claimed)} mark={pct(needed)} />
      </span>
      {/* Status travels with an icon and a word (DESIGN.md). */}
      <span
        className={cx(
          'inline-flex h-6.5 items-center gap-1.5 rounded-full border ps-1.75 pe-2.25 text-meta font-medium whitespace-nowrap',
          outcome.ok ? 'border-ok-border bg-ok-bg text-ok-text' : 'border-warn-border bg-warn-bg text-warn-text',
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-3.5 flex-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {outcome.icon}
        </svg>
        {outcome.label}
      </span>
    </div>
  );
}
