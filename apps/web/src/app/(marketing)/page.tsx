import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { ReactNode } from 'react';
import { MarketingHome } from '@/features/marketing-home/components/MarketingHome.tsx';
import { citeExact, heroCandidate as h } from '@/features/marketing-home/domain/hero.ts';

const mark = (chunks: ReactNode) => (
  <mark className="mk-sweep rounded-tag bg-hl px-2 text-hl-text box-decoration-clone">{chunks}</mark>
);

// Public: the website (AIV-P5-001). It reads no session and no candidate data.
export default async function WebsitePage() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const evidence = t('home.card.evidence');
  return (
    <MarketingHome
      labels={{
        skipToContent: t('shell.skipToContent'),
        wordmark: t('app.title'),
        homeLabel: t('home.nav.home'),
        navLabel: t('home.nav.label'),
        howItWorks: t('home.nav.howItWorks'),
        roles: t('home.nav.roles'),
        trust: t('home.nav.trust'),
        candidates: t('home.nav.candidates'),
        signIn: t('home.signIn'),
        createWorkspaceShort: t('home.nav.createWorkspace'),
        headline: t.rich('home.headline', { mark }),
        lead: t('home.lead'),
        createWorkspace: t('home.createWorkspace'),
        seeProduct: t('home.seeProduct'),
        reassurance: t('home.reassurance'),
      }}
      card={{
        backed: h.backed,
        upTo: h.upTo,
        evidence,
        citations: citeExact(evidence, t('home.card.cited'), 'checkout-e2e'),
        labels: {
          name: t('home.card.name'),
          role: t('home.card.role', { rank: h.rank, total: h.total }),
          scoreName: t('home.card.scoreName', h),
          backed: t('home.card.backed', h),
          caption: t('home.card.caption', h),
          upTo: t('home.card.upTo', h),
          unavailable: t('home.card.unavailable'),
          competency: t('home.card.competency'),
          weight: t('home.card.weight', { weight: h.weight }),
          strength: t('home.card.strength'),
          provenance: t('home.card.provenance'),
          markLabel: t('home.card.markLabel'),
          sources: t('home.card.sources'),
          sourceRepo: t('home.card.sourceRepo'),
          sourceCi: t('home.card.sourceCi'),
          synthetic: t('home.card.synthetic'),
        },
      }}
    />
  );
}
