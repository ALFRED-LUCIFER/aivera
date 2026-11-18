import { JOB_TYPE_CATALOGUE } from '@aivera/jobs';
import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { ReactNode } from 'react';
import { HowItWorks } from '@/features/marketing-home/components/HowItWorks.tsx';
import { MarketingHome } from '@/features/marketing-home/components/MarketingHome.tsx';
import { RoleFamilies } from '@/features/marketing-home/components/RoleFamilies.tsx';
import { SiteFooter, TrustAndFooter } from '@/features/marketing-home/components/TrustAndFooter.tsx';
import { ScrollSweep } from '@/features/marketing-home/components/ScrollSweep.tsx';
import { citeExact, heroCandidate as h } from '@/features/marketing-home/domain/hero.ts';
import { howSteps, trustPrinciples } from '@/features/marketing-home/domain/sections.ts';
// The website's motion stylesheet: here, because a feature's components/ holds .tsx only (ADR-003).
import './marketing.css';

const mark = (chunks: ReactNode) => (
  <mark className="mk-sweep rounded-tag bg-hl px-2 text-hl-text box-decoration-clone">{chunks}</mark>
);

const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
const sweep = (chunks: ReactNode) => <ScrollSweep>{chunks}</ScrollSweep>;

// Public: the website (AIV-P5-001). It reads no session and no candidate data.
export default async function WebsitePage() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const evidence = t('home.card.evidence');
  return (
    <MarketingHome
      footer={
        <SiteFooter
          wordmark={t('app.title')}
          signIn={t('home.signIn')}
          footerLabel={t('home.footer.label')}
          howItWorks={t('home.nav.howItWorks')}
          roles={t('home.nav.roles')}
          trust={t('home.nav.trust')}
          // The composition root reads the year; no Clock port exists in the web app yet.
          copyright={t('home.footer.copyright', { year: new Date().getUTCFullYear() })}
        />
      }
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
    >
      <HowItWorks
        contrast={[t('home.contrast.claims'), t('home.contrast.tests'), t.rich('home.contrast.work', { mark: sweep })]}
        title={t('home.how.title')}
        steps={howSteps.map((key) => ({
          title: t(`home.how.steps.${key}.title`),
          body: t(`home.how.steps.${key}.body`),
        }))}
      />
      <RoleFamilies
        title={t('home.roleFamilies.title')}
        lead={t('home.roleFamilies.lead')}
        noPublicWork={t('home.roleFamilies.noPublicWork')}
        familyHeader={t('home.roleFamilies.family')}
        evidenceHeader={t('home.roleFamilies.evidence')}
        rows={JOB_TYPE_CATALOGUE.map((j) => ({ key: j.key, family: t(j.labelKey), evidence: t(j.evidenceKey) }))}
        more={t.rich('home.roleFamilies.more', { strong })}
      />
      <TrustAndFooter
        trustTitle={t('home.trust.title')}
        principles={trustPrinciples.map((key) => ({
          title: t(`home.trust.principles.${key}.title`),
          body: t(`home.trust.principles.${key}.body`),
        }))}
        pilotTitle={t('home.pilot.title')}
        pilotBody={t('home.pilot.body')}
        createWorkspace={t('home.createWorkspace')}
        signIn={t('home.signIn')}
      />
    </MarketingHome>
  );
}
