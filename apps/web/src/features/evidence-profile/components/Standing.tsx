'use client';

import { useTranslations } from '@credalent/i18n/react';
import { ProvenanceTag, StrengthMeter } from '@credalent/ui';
import type { EvidenceCard } from '../domain/evidenceCards.ts';

// AIV-P1-165 §11, "Calm evidence cards": how a competency's cited evidence states its strength and its limit, on the
// profile and on the scorecard. Both use the shared StrengthMeter and ProvenanceTag; deviations are listed in
// EvidenceCards.tsx.

type Lead = NonNullable<EvidenceCard['lead']>;

/**
 * A strength with its provenance. A claim shows the strength it is stored with, the same label Compare shows for the
 * same line (#677 §10, decided 28 Nov 2026), and is named a claim in neutral ink beside it: no warning-coloured pill.
 * `under` is the row's lead when this is one item of the row: a second claim under a claim says nothing new.
 */
export function Standing({ strength, provenance, under }: Lead & { under?: Lead | null }) {
  const t = useTranslations();
  if (provenance === 'claim') {
    if (under?.provenance === 'claim') return null;
    // SAFETY: a claim is called a claim (AGENTS.md 1.6); its zero is stated once by LimitLine.
    return (
      <>
        <StrengthMeter strength={strength} label={t(`rubric.strength.${strength}`)} />
        <span className="text-meta text-text-2">{t('evidence.provenance.claim')}</span>
      </>
    );
  }
  return (
    <>
      <StrengthMeter strength={strength} label={t(`rubric.strength.${strength}`)} />
      <ProvenanceTag provenance={provenance} label={t(`evidence.provenance.${provenance}`)} />
    </>
  );
}

/**
 * A row's limit, stated once: a row resting only on claims says it counts zero in the backed score, whatever strength
 * the claim is stored with (AGENTS.md 1.6); any other row gives its cited items' limits on one line.
 */
export function LimitLine({ card }: { card: Pick<EvidenceCard, 'claimOnly' | 'limits'> }) {
  const t = useTranslations('candidateProfile');
  if (!card.claimOnly && card.limits.length === 0) return null;
  return (
    <p className="max-w-[72ch] text-meta text-text-2">
      <strong className="font-semibold text-text">{t('limit')}</strong>{' '}
      {/* SAFETY: claim-only is decided by what backs the proven level, never by the lead's stored strength. */}
      {card.claimOnly ? t('claimLimit') : card.limits.join(' ')}
    </p>
  );
}
