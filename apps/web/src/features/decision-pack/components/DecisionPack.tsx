'use client';

import { useTranslations } from '@credalent/i18n/react';
import { ScoreWithUncertainty } from '@credalent/ui';
import type { PackPage } from '../domain/pack.ts';

// AIV-P2-010: the decision pack a recruiter built from the ranking, from the Pack artboard
// (docs/01-design/artboards/Pack.dc.html). Deviation: only the pack's title and its members with the scores they
// joined with; the strengths, risks, cited recommendation and the hiring owner's decisions are AIV-P2-011 (#125).

export function DecisionPack({ pack }: { pack: PackPage }) {
  const t = useTranslations();
  return (
    <section aria-labelledby="pack-title" className="flex flex-col gap-3 self-stretch">
      <h2 id="pack-title" className="text-card text-text">
        {t('decisionPack.title', { name: pack.name, job: pack.job })}
      </h2>
      <p className="text-body text-text-2">{t('decisionPack.members', { count: pack.members.length })}</p>
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {pack.members.map((m) => (
          <li key={m.candidateId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <span className="font-semibold text-text">{m.name ?? t('ranking.unnamed')}</span>
            <span className="min-w-44">
              <ScoreWithUncertainty
                compact
                backed={m.backedScore}
                upTo={m.upperBound}
                backedLabel={(backed) => t('score.backed', { backed })}
                captionLabel={(backed, upTo) => t('score.backedUpToCompact', { backed, upTo })}
                upToLabel={(upTo) => t('score.upToCompact', { upTo })}
                unavailableLabel={t('score.unavailable')}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
