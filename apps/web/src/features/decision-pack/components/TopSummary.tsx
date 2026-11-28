'use client';

import type { CitedStatement } from '@credalent/decisions';
import { useTranslations } from '@credalent/i18n/react';
import { Card } from '@credalent/ui';
import { standing, type PackPreview } from '../domain/pack.ts';

// AIV-P1-165 section 13: the pack's top summary, on the pack page and the hiring owner's preview. One line per person,
// in the pack's order (highest backed score first): name, backed score and "up to", what separates them from the one
// above, one cited strength and one risk, each the first the card states, with its source named. Not on the Pack or
// ClientPack artboard: the ticket adds it so the pack can be read and decided on without the recruiter in the room.
// Plain text, no links: each card below carries the linked sources, and the preview links nowhere (AGENTS.md 1.9).

export function TopSummary({ members }: { members: PackPreview['members'] }) {
  const t = useTranslations();
  const nameOf = (m: PackPreview['members'][number] | undefined) => m?.name ?? t('ranking.unnamed');
  const cited = (key: 'strength' | 'risk', statement: CitedStatement | undefined) => {
    const source = statement?.citations[0];
    return (
      <p>
        {t(`decisionPack.top.${key}`, { text: statement?.text ?? t('decisionPack.summary.none') })}
        {source && (
          <span className="text-meta text-text-2">
            {' · '}
            {source.itemId === null
              ? t('decisionPack.summary.assessment')
              : t('decisionPack.summary.source', { label: source.label })}
          </span>
        )}
      </p>
    );
  };
  return (
    <section aria-labelledby="pack-top-summary">
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="pack-top-summary" className="text-section text-text">
              {t('decisionPack.top.title')}
            </h3>
            <p className="text-meta text-text-2">{t('decisionPack.top.order')}</p>
          </div>
          <ol className="flex list-decimal flex-col gap-3 ps-5 text-body text-text">
            {members.map((m, i) => {
              const s = standing(members, i, nameOf(members[i - 1]));
              return (
                <li key={m.candidateId}>
                  <p>
                    <strong className="font-semibold">{nameOf(m)}</strong>
                    <span className="tabular-nums">
                      {' · '}
                      {t('score.backedUpToCompact', { backed: m.backedScore, upTo: m.upperBound })}
                    </span>
                  </p>
                  <p className="text-meta text-text-2">
                    {s.key === 'first' ? t('decisionPack.top.first') : t(`decisionPack.top.${s.key}`, s)}
                  </p>
                  {m.summary.status === 'ready' ? (
                    <>
                      {cited('strength', m.summary.summary.strengths[0])}
                      {cited('risk', m.summary.summary.risks[0])}
                    </>
                  ) : (
                    <p className="text-text-2">
                      {t(`decisionPack.summary.${m.summary.status === 'preparing' ? 'preparing' : 'unavailable'}`)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </Card>
    </section>
  );
}
