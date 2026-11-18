import { buttonClassName } from '@aivera/ui';
import { links } from '../domain/links.ts';
import { column } from './column.ts';
import { sectionTitle } from './HowItWorks.tsx';
import { DrawnRule, Reveal } from './Reveal.tsx';

export type TrustAndFooterProps = {
  trustTitle: string;
  principles: readonly { title: string; body: string }[];
  pilotTitle: string;
  pilotBody: string;
  createWorkspace: string;
  signIn: string;
};

export type SiteFooterProps = {
  wordmark: string;
  footerLabel: string;
  howItWorks: string;
  roles: string;
  trust: string;
  signIn: string;
  copyright: string;
};

const footerLink = 'inline-flex min-h-11 items-center text-text-2 hover:text-text';

/** The trust principles and the pilot promise (Landing artboard). */
export function TrustAndFooter(p: TrustAndFooterProps) {
  return (
    <>
      <section
        aria-labelledby="why-trust-it"
        className={`${column} flex flex-col gap-8 pt-[clamp(40px,5vw,72px)] pb-[clamp(56px,7vw,104px)]`}
      >
        <h2 id="why-trust-it" tabIndex={-1} className={`${sectionTitle} max-w-[22ch]`}>
          {p.trustTitle}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-x-10 gap-y-8">
          {p.principles.map((pr, i) => (
            <li key={pr.title} className="flex flex-col gap-2">
              <span className="mb-3">
                <DrawnRule index={i} />
              </span>
              <h3 className="text-section">{pr.title}</h3>
              <p className="text-[16px] leading-6 text-text-2">{pr.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* An ink panel like the contrast: dark tokens in either theme. */}
      <section data-theme="dark" aria-labelledby="pilot" className="border-y border-border bg-surface text-text">
        <div
          className={`${column} flex flex-wrap items-center justify-between gap-x-14 gap-y-8 py-[clamp(56px,7vw,96px)]`}
        >
          <Reveal className="flex min-w-0 flex-[3_1_420px] flex-col gap-3.5">
            <h2 id="pilot" className={`${sectionTitle} max-w-[20ch]`}>
              {p.pilotTitle}
            </h2>
            <p className="max-w-[56ch] text-[17px] leading-[26px] text-text-2">{p.pilotBody}</p>
          </Reveal>
          <Reveal index={1} className="flex flex-wrap gap-3">
            <a className={buttonClassName('primary', 'touch')} href={links.signUp}>
              {p.createWorkspace}
            </a>
            <a className={buttonClassName('secondary', 'touch')} href={links.signIn}>
              {p.signIn}
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}

/** The website footer (Landing artboard). */
export function SiteFooter(p: SiteFooterProps) {
  return (
    <footer className="border-t border-border">
      <div className={`${column} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-6 text-body`}>
        <span className="font-display text-card font-bold">{p.wordmark}</span>
        <nav aria-label={p.footerLabel} className="flex flex-wrap gap-x-5">
          <a className={footerLink} href={links.howItWorks}>
            {p.howItWorks}
          </a>
          <a className={footerLink} href={links.roles}>
            {p.roles}
          </a>
          <a className={footerLink} href={links.trust}>
            {p.trust}
          </a>
          <a className={footerLink} href={links.signIn}>
            {p.signIn}
          </a>
        </nav>
        {/* shortcut: the privacy notice and terms links join this row when AIV-P5-011 publishes them. */}
        <span className="text-meta text-text-2">{p.copyright}</span>
      </div>
    </footer>
  );
}
