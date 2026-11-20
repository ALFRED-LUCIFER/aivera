import { buttonClassName } from '@credalent/ui';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { column } from '../domain/layout.ts';
import { links } from '../domain/links.ts';
import { EvidenceCard, type EvidenceCardProps } from './EvidenceCard.tsx';

export type MarketingHomeLabels = {
  skipToContent: string;
  wordmark: string;
  homeLabel: string;
  navLabel: string;
  howItWorks: string;
  roles: string;
  trust: string;
  candidates: string;
  signIn: string;
  createWorkspaceShort: string;
  /** The headline with the highlighter on "evidence". */
  headline: ReactNode;
  lead: string;
  createWorkspace: string;
  seeProduct: string;
  reassurance: string;
};

export type MarketingHomeProps = {
  labels: MarketingHomeLabels;
  card: EvidenceCardProps;
  children?: ReactNode;
  /** Rendered after <main>, so it is the page's contentinfo landmark. */
  footer: ReactNode;
};

const step = (n: number) => ({ '--mk-step': n }) as CSSProperties;

const arrow = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-4.5 flex-none transition-transform duration-120 ease-case group-hover:translate-x-0.5 motion-reduce:transition-none rtl:-scale-x-100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

// The ink underline draws in from the start edge on hover, as on the artboard's .wlink.
const navLink =
  'inline-flex min-h-11 items-center px-1.5 font-medium text-text-2 hover:text-text ' +
  'bg-[linear-gradient(currentColor,currentColor)] bg-no-repeat bg-position-[6px_calc(100%-10px)] rtl:bg-position-[calc(100%-6px)_calc(100%-10px)] bg-size-[0_1.5px] ' +
  'transition-[background-size,color] duration-240 ease-case hover:bg-size-[calc(100%-12px)_1.5px] motion-reduce:transition-none';

/** The website (Landing artboard): header, hero and the sections the page passes as children. */
export function MarketingHome({ labels: l, card, children, footer }: MarketingHomeProps) {
  return (
    <div className="mk-page flex min-h-screen flex-col bg-bg text-text">
      {/* Without JavaScript nothing waits for a scroll reveal. */}
      <noscript>
        <style>{'.mk-reveal{opacity:1!important;transform:none!important}'}</style>
      </noscript>
      <a
        href="#main"
        className="sr-only rounded-control bg-action px-3 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {l.skipToContent}
      </a>
      <header className="sticky top-0 z-10 border-b border-border bg-bg">
        <div className={`${column} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5`}>
          <Link
            href="/"
            aria-label={l.homeLabel}
            className="inline-flex min-h-11 items-center font-display text-[20px] font-bold tracking-tight text-text"
          >
            {l.wordmark}
          </Link>
          <nav aria-label={l.navLabel} className="order-last flex w-full flex-wrap gap-x-4 md:order-none md:w-auto">
            <a className={navLink} href={links.howItWorks}>
              {l.howItWorks}
            </a>
            <a className={navLink} href={links.roles}>
              {l.roles}
            </a>
            <a className={navLink} href={links.trust}>
              {l.trust}
            </a>
            <a className={navLink} href={links.candidates}>
              {l.candidates}
            </a>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <a className={buttonClassName('ghost')} href={links.signIn}>
              {l.signIn}
            </a>
            <a className={buttonClassName('secondary')} href={links.signUp}>
              {l.createWorkspaceShort}
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section className={`${column} flex flex-wrap items-center gap-x-14 gap-y-12 py-[clamp(48px,7vw,96px)]`}>
          <div className="flex min-w-0 flex-[6_1_440px] flex-col gap-6">
            <h1
              className="mk-rise font-display text-[clamp(44px,6.4vw,84px)] leading-[1.02] font-bold tracking-[-0.035em] text-balance"
              style={step(0)}
            >
              {l.headline}
            </h1>
            <p
              className="mk-rise max-w-[54ch] text-[clamp(17px,1.5vw,20px)] leading-normal text-text-2"
              style={step(1)}
            >
              {l.lead}
            </p>
            <div className="mk-rise flex flex-wrap gap-3" style={step(2)}>
              <a className={`group ${buttonClassName('primary', 'touch')}`} href={links.signUp}>
                {l.createWorkspace}
                {arrow}
              </a>
              <a className={buttonClassName('secondary', 'touch')} href={links.product}>
                {l.seeProduct}
              </a>
            </div>
            <p className="mk-rise text-body text-text-2" style={step(3)}>
              {l.reassurance}
            </p>
          </div>
          <div className="mk-rise min-w-0 flex-[5_1_380px]" style={step(4)}>
            <EvidenceCard {...card} />
          </div>
        </section>
        {children}
      </main>
      {footer}
    </div>
  );
}
