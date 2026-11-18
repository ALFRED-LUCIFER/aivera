import type { ReactNode } from 'react';
import { column } from './column.ts';
import { sectionTitle } from './HowItWorks.tsx';
import { Reveal } from './Reveal.tsx';

export type RoleFamiliesProps = {
  title: string;
  lead: string;
  noPublicWork: string;
  familyHeader: string;
  evidenceHeader: string;
  /** One row per job type, in the catalogue's order (@aivera/jobs), so the website and Add a job agree. */
  rows: readonly { key: string; family: string; evidence: string }[];
  more: ReactNode;
};

/** "Not only software engineers" (Landing artboard). */
export function RoleFamilies(p: RoleFamiliesProps) {
  return (
    <section
      aria-labelledby="roles"
      className={`${column} flex flex-wrap items-start gap-x-14 gap-y-8 py-[clamp(40px,5vw,72px)]`}
    >
      <Reveal className="flex min-w-0 flex-[4_1_320px] flex-col gap-4">
        <h2 id="roles" tabIndex={-1} className={`${sectionTitle} max-w-[22ch]`}>
          {p.title}
        </h2>
        <p className="max-w-[44ch] text-[17px] leading-[26px] text-text-2">{p.lead}</p>
        <p className="max-w-[44ch] text-body text-text-2">{p.noPublicWork}</p>
      </Reveal>
      {/* A reading table with row headers, not the app's DataTable (sorting, selection, dense cells). */}
      <Reveal
        index={1}
        className="min-w-0 flex-[7_1_480px] overflow-hidden rounded-card border border-border bg-surface shadow-1"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-120 border-collapse text-start">
            <thead>
              <tr className="border-b border-border text-meta font-semibold text-text-2">
                <th scope="col" className="px-5 py-3 text-start">
                  {p.familyHeader}
                </th>
                <th scope="col" className="px-5 py-3 text-start">
                  {p.evidenceHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-b border-border transition-colors duration-120 ease-case last:border-b-0 hover:bg-surface-subtle motion-reduce:transition-none"
                >
                  <th
                    scope="row"
                    className="min-w-50 px-5 py-4 text-start align-top text-[16px] font-semibold text-text"
                  >
                    {r.family}
                  </th>
                  <td className="px-5 py-4 text-[16px] leading-6 text-text-2">{r.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-[46ch] border-t border-border px-5 py-4.5 text-[16px] leading-6 text-text-2 [&_strong]:font-semibold [&_strong]:text-text">
          {p.more}
        </p>
      </Reveal>
    </section>
  );
}
