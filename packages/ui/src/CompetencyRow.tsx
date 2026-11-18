import { ProvenanceTag, type Provenance } from './ProvenanceTag.tsx';
import { StrengthMeter, type Strength } from './StrengthMeter.tsx';

export type CompetencyRowProps = {
  /** "Retrieval and evaluation". */
  name: string;
  /** "Weight 20% · mandatory", from i18n. */
  weightLabel: string;
  strength: Strength;
  /** "Medium", from i18n. */
  strengthLabel: string;
  /** "Counts as zero" next to a claim-only strength (AGENTS.md 1.6), from i18n. */
  countsAsZeroLabel?: string;
  provenance: Provenance;
  /** "Claim awaiting validation", from i18n. */
  provenanceLabel: string;
  /** "2 sources", from i18n. */
  sourcesLabel: string;
  /** Where the sources are listed. */
  sourcesHref: string;
};

/** Foundations artboard "Competency row" and the Candidate profile. */
export function CompetencyRow(p: CompetencyRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-border bg-surface px-4 py-3.5 text-body">
      <div className="min-w-0 flex-1 basis-50">
        <div className="font-semibold text-text">{p.name}</div>
        <div className="text-meta text-text-2">{p.weightLabel}</div>
      </div>
      <StrengthMeter
        strength={p.strength}
        label={p.strengthLabel}
        {...(p.countsAsZeroLabel !== undefined && { countsAsZeroLabel: p.countsAsZeroLabel })}
      />
      <ProvenanceTag provenance={p.provenance} label={p.provenanceLabel} />
      <a
        href={p.sourcesHref}
        className="inline-flex min-h-10 items-center font-medium text-text underline underline-offset-2 pointer-coarse:min-h-11"
      >
        {p.sourcesLabel}
      </a>
    </div>
  );
}
