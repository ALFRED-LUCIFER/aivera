'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Card, Chip } from '@aivera/ui';
import { CATALOGUE_SOURCES, type CatalogueView } from '../domain/catalogue.ts';

type PackJobType = CatalogueView['domainPacks']['packs'][number]['jobTypes'][number];
type Entry = PackJobType['core'][number] | PackJobType['hints']['uae'][number];

const REGIONS = ['uae', 'ksa', 'india'] as const;
const LEVELS = [1, 3, 5] as const;
const link = 'underline underline-offset-2 hover:text-text';
const summary =
  'flex min-h-10 cursor-pointer items-center gap-2 rounded-control px-2 font-semibold text-text pointer-coarse:min-h-11';

/** One competency or regional hint: what it means, the evidence that counts and its level guide. Always desirable. */
function CatalogueEntry({ entry }: { entry: Entry }) {
  const t = useTranslations('ops.catalogue');
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3">
      <h4 className="text-body font-semibold text-text">{entry.name}</h4>
      <p className="text-body text-text-2">{entry.meaning}</p>
      <p className="flex flex-wrap gap-2">
        <Chip>{t('desirable')}</Chip>
        <Chip>{t('levelNeeded', { level: entry.levelNeeded })}</Chip>
      </p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="text-meta font-semibold text-text-2">{t('evidence')}</dt>
        <dd className="text-body text-text">{entry.evidence}</dd>
        {LEVELS.map((level) => (
          <div key={level} className="contents">
            <dt className="text-meta font-semibold text-text-2">{t('level', { level })}</dt>
            <dd className="text-body text-text">{entry.levels[level]}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function EntryGroup({ title, entries }: { title: string; entries: readonly Entry[] }) {
  if (!entries.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-meta font-semibold text-text-2">{title}</h3>
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <CatalogueEntry key={entry.name} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The job types and domain packs, read-only (AIV-P5-015). Editing is a reviewed pull request, so there are no controls
 * here; packs and job types expand with native disclosure, which the keyboard opens with Enter or Space.
 */
export function Catalogue({ view }: { view: CatalogueView }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-body text-text-2">
        <p>{t('ops.catalogue.readOnly')}</p>
        <a href={CATALOGUE_SOURCES.jobTypes} className={link}>
          {t('ops.catalogue.jobTypesSource')}
        </a>
        <a href={CATALOGUE_SOURCES.domainPacks} className={link}>
          {t('ops.catalogue.domainPacksSource')}
        </a>
      </div>

      <Card title={t('ops.catalogue.jobTypes', { version: view.jobTypes.version })} level={2}>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead className="text-meta text-text-2">
              <tr>
                <th scope="col" className="py-2 pe-4 text-start font-semibold">
                  {t('ops.catalogue.columns.jobType')}
                </th>
                <th scope="col" className="py-2 pe-4 text-start font-semibold">
                  {t('ops.catalogue.evidence')}
                </th>
                <th scope="col" className="py-2 text-start font-semibold">
                  {t('ops.catalogue.columns.starters')}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.jobTypes.entries.map((entry) => (
                <tr key={entry.key} className="border-t border-border align-top">
                  <th scope="row" className="py-2 pe-4 text-start font-semibold text-text">
                    {t(entry.labelKey)}
                  </th>
                  <td className="py-2 pe-4 text-text-2">{t(entry.evidenceKey)}</td>
                  <td className="py-2 text-text">
                    <ul>
                      {entry.starterCompetencies.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t('ops.catalogue.domainPacks', { version: view.domainPacks.version })} level={2}>
        <ul className="flex flex-col gap-1">
          {view.domainPacks.packs.map((pack) => (
            <li key={pack.key}>
              <details className="rounded-control border border-border">
                <summary className={summary}>
                  {t(pack.labelKey)}
                  <span className="ms-auto text-meta font-normal text-text-2">
                    {t('ops.catalogue.packSummary', {
                      version: view.domainPacks.version,
                      count: pack.jobTypes.length,
                    })}
                  </span>
                </summary>
                <ul className="flex flex-col gap-1 p-2">
                  {pack.jobTypes.map((entry) => (
                    <li key={entry.jobType}>
                      <details>
                        <summary className={summary}>
                          {t(entry.labelKey)}
                          <span className="ms-auto text-meta font-normal text-text-2">
                            {t('ops.catalogue.competencies', { count: entry.count })}
                          </span>
                        </summary>
                        <div className="flex flex-col gap-4 px-2 pt-2 pb-4">
                          <EntryGroup title={t('ops.catalogue.core')} entries={entry.core} />
                          <EntryGroup title={t('ops.catalogue.more')} entries={entry.more} />
                          {REGIONS.map((region) => (
                            <EntryGroup
                              key={region}
                              title={t(`ops.catalogue.hints.${region}`)}
                              entries={entry.hints[region]}
                            />
                          ))}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
