import { buttonClassName } from '@aivera/ui';
import { links } from '../domain/links.ts';
import { column, sectionTitle } from '../domain/layout.ts';
import { DrawnRule, Reveal } from './Reveal.tsx';

export type TrustAndPilotProps = {
  trustTitle: string;
  principles: readonly { title: string; body: string }[];
  pilotTitle: string;
  pilotBody: string;
  createWorkspace: string;
  signIn: string;
};

/** The trust principles and the pilot promise (Landing artboard). */
export function TrustAndPilot(p: TrustAndPilotProps) {
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
            {/* Secondary: the hero holds the page's one primary (DESIGN.md). */}
            <a className={buttonClassName('secondary', 'touch')} href={links.signUp}>
              {p.createWorkspace}
            </a>
            <a className={buttonClassName('ghost', 'touch')} href={links.signIn}>
              {p.signIn}
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
