import type { ReactNode } from 'react';
import { column, sectionTitle } from '../domain/layout.ts';
import { Reveal } from './Reveal.tsx';

export type HowItWorksProps = {
  /** "A CV tells you…", "A test tells you…", then the work line with its highlighter. */
  contrast: readonly [string, string, ReactNode];
  title: string;
  steps: readonly { title: string; body: string }[];
};

const contrastLine = 'font-display text-[clamp(22px,2.4vw,30px)] leading-tight font-semibold tracking-[-0.015em]';

/** The claims-tests-work contrast on an ink panel, then the five steps (Landing artboard). */
export function HowItWorks({ contrast: [claims, tests, work], title, steps }: HowItWorksProps) {
  return (
    <>
      {/* The ink panel keeps the dark tokens in either theme (DESIGN.md). */}
      <section data-theme="dark" className="border-y border-border bg-surface text-text">
        <div
          className={`${column} grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-12 gap-y-8 py-[clamp(48px,6vw,80px)]`}
        >
          <Reveal index={0}>
            <p className={`${contrastLine} text-text-2`}>{claims}</p>
          </Reveal>
          <Reveal index={1}>
            <p className={`${contrastLine} text-text-2`}>{tests}</p>
          </Reveal>
          <Reveal index={2}>
            <p className={contrastLine}>{work}</p>
          </Reveal>
        </div>
      </section>

      <section
        aria-labelledby="how-it-works"
        className={`${column} flex flex-col gap-8 pt-[clamp(56px,7vw,104px)] pb-[clamp(32px,4vw,56px)]`}
      >
        {/* tabIndex -1: the header's "How it works" link moves focus here, not only the scroll position. */}
        <h2 id="how-it-works" tabIndex={-1} className={`${sectionTitle} max-w-[22ch]`}>
          {title}
        </h2>
        <ol className="border-b border-border">
          {steps.map((s, i) => (
            <Reveal
              as="li"
              key={s.title}
              index={i}
              className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-5 gap-y-2 border-t border-border py-6"
            >
              <span
                aria-hidden="true"
                className="font-display text-[32px] leading-9 font-bold text-text-3 tabular-nums"
              >
                {i + 1}
              </span>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-x-10 gap-y-1.5">
                <h3 className="text-[20px] leading-7 font-semibold">{s.title}</h3>
                <p className="text-[16px] leading-6 text-text-2">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>
    </>
  );
}
