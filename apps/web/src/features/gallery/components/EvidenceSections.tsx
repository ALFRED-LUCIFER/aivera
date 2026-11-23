'use client';

import { useTranslations } from '@credalent/i18n/react';
import {
  CompetencyRow,
  EvidenceHighlight,
  LevelMeter,
  NeedVsProvenBar,
  ProvenanceTag,
  ScoreWithUncertainty,
  StatTile,
  StrengthMeter,
  ValueBasis,
} from '@credalent/ui';
import type { ComponentProps } from 'react';
import { citations, evidenceText, sample } from '../domain/sample.ts';
import { Section, State } from './Section.tsx';

const s = sample.sections;

/** The score labels from packages/i18n, shared by the score section and the table's score column. */
export function useScoreLabels(compact = false) {
  const t = useTranslations('score');
  return {
    backedLabel: (backed: number) => t('backed', { backed }),
    captionLabel: (backed: number, upTo: number) => t(compact ? 'backedUpToCompact' : 'backedUpTo', { backed, upTo }),
    upToLabel: (upTo: number) => t('upToCompact', { upTo }),
    unavailableLabel: t('unavailable'),
    compact,
  } satisfies Partial<ComponentProps<typeof ScoreWithUncertainty>>;
}

// shortcut: the "Score cannot be shown" state is not shown; the score components throw on bad values outside production by
// design, so the gallery (development only) cannot render it. Unit tests in packages/ui cover it.
export function EvidenceSections() {
  const t = useTranslations();
  const score = useScoreLabels();
  const compactScore = useScoreLabels(true);
  const need = (name: string, proven: number, claimed: number, needed: number) => (
    <NeedVsProvenBar
      name={name}
      proven={proven}
      claimed={claimed}
      needed={needed}
      levelLabel={(v) => t('score.level', v)}
      barLabel={(v) => t('score.levelBar', v)}
      aboveLabel={t('score.aboveNeed')}
      meetsLabel={t('score.meetsNeed')}
      shortLabel={(short, claimedToo) => t(claimedToo ? 'score.shortClaimed' : 'score.short', { short })}
      unavailableLabel={t('score.unavailable')}
    />
  );
  const [cost, retrieval, arabic, production] = sample.needNames;
  return (
    <>
      <Section id="basis" title={s.basis}>
        <div className="flex flex-wrap gap-2">
          <ValueBasis basis="observed" label={sample.basis.observed} />
          <ValueBasis basis="baseline" label={sample.basis.baseline} />
          <ValueBasis basis="projection" label={sample.basis.projection} />
          <ValueBasis basis="not-available" label={sample.basis.notAvailable} />
        </div>
      </Section>

      <Section id="stat" title={s.stat}>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label={sample.stat.waiting}
            value="3"
            basis="observed"
            basisLabel={sample.basis.observed}
            notAvailableLabel={sample.basis.notAvailable}
            detail={sample.stat.oldest}
            action={<a href="#stat">{sample.stat.view}</a>}
          />
          <StatTile
            label={sample.stat.ai}
            value={null}
            basis="observed"
            basisLabel={sample.basis.observed}
            notAvailableLabel={sample.basis.notAvailable}
          />
          <StatTile
            label={sample.stat.catalogue}
            value={null}
            basis="observed"
            basisLabel={sample.basis.observed}
            notAvailableLabel={sample.basis.notAvailable}
            error={sample.stat.error}
            action={<a href="#stat">{sample.stat.retry}</a>}
          />
        </div>
      </Section>

      <Section id="provenance" title={s.provenance}>
        <div className="flex flex-wrap gap-2">
          <ProvenanceTag provenance="corroborated" label={sample.provenance.corroborated} />
          <ProvenanceTag provenance="submitted" label={sample.provenance.submitted} />
          <ProvenanceTag provenance="claim" label={sample.provenance.claim} />
          <ProvenanceTag provenance="contradictory" label={sample.provenance.contradictory} />
          <ProvenanceTag provenance="awaiting-defence" label={sample.provenance.awaitingDefence} />
        </div>
      </Section>

      <Section id="strength" title={s.strength}>
        <div className="flex flex-wrap gap-6">
          <StrengthMeter strength="strong" label={sample.strength.strong} />
          <StrengthMeter strength="medium" label={sample.strength.medium} />
          <StrengthMeter strength="supporting" label={sample.strength.supporting} />
          <StrengthMeter
            strength="claim"
            label={sample.strength.claim}
            countsAsZeroLabel={sample.strength.countsAsZero}
          />
        </div>
      </Section>

      <Section id="level" title={s.level}>
        <div className="flex flex-wrap gap-6">
          {sample.levels.map(([level, label]) => (
            <LevelMeter key={level} level={level} label={label} />
          ))}
          <LevelMeter {...sample.meetsNeed} />
        </div>
      </Section>

      <Section id="score" title={s.score}>
        <State title={sample.scoreStates.open}>
          <ScoreWithUncertainty backed={62} upTo={78} {...score} />
        </State>
        <State title={sample.scoreStates.closed}>
          <ScoreWithUncertainty backed={72} upTo={72} {...score} />
        </State>
        <State title={sample.scoreStates.compact}>
          <ScoreWithUncertainty backed={68} upTo={84} {...compactScore} />
        </State>
      </Section>

      <Section id="need" title={s.need}>
        <div className="divide-y divide-border">
          {need(cost ?? '', 1, 4, 2)}
          {need(retrieval ?? '', 2, 3, 3)}
          {need(arabic ?? '', 1, 1, 3)}
          {need(production ?? '', 4, 4, 3)}
        </div>
      </Section>

      <Section id="evidence" title={s.evidence}>
        <p className="max-w-prose text-body text-text">
          <EvidenceHighlight text={evidenceText} citations={citations} markLabel={sample.markLabel} />
        </p>
      </Section>

      <Section id="competency" title={s.competency}>
        <CompetencyRow
          name={sample.competency.retrieval}
          weightLabel={t('competency.weightMandatory', { weight: '20%' })}
          strength="medium"
          strengthLabel={sample.strength.medium}
          provenance="corroborated"
          provenanceLabel={sample.provenance.corroborated}
          sourcesLabel={t('competency.sources', { count: 2 })}
          sourcesHref="#evidence"
        />
        <CompetencyRow
          name={sample.competency.arabic}
          weightLabel={t('competency.weight', { weight: '10%' })}
          strength="claim"
          strengthLabel={sample.strength.claim}
          countsAsZeroLabel={sample.strength.countsAsZero}
          provenance="claim"
          provenanceLabel={sample.provenance.claim}
          sourcesLabel={t('competency.sources', { count: 1 })}
          sourcesHref="#evidence"
        />
      </Section>
    </>
  );
}
