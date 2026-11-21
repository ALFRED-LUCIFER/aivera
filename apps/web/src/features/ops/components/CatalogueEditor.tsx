'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, Chip, StatusBadge, type StatusBadgeStatus } from '@credalent/ui';
import type { ReactNode } from 'react';
import type {
  CompetencyRow,
  EditorViewModel,
  EntryStatus,
  HintRow,
  JobTypeRow,
  PackRow,
  Refusal,
  RegionRow,
} from '../domain/catalogueEditor.ts';
import { CompetencyFormDialog, JobTypeFormDialog, PackFormDialog, RefusalText } from './CatalogueForms.tsx';

/*
 * The catalogue editor (AIV-P2-045), from the console spec's catalogue editor layout (operator-console.md); there is no
 * artboard for it. Deviations: job types are one list, then the regions (AIV-P2-059), and entries are grouped by pack,
 * a pack's regional hints (AIV-P2-046) following its competencies, one section per region; the entry form opens in a
 * dialog rather than in the main column, so the long pack list keeps its place.
 */

const BADGES: Record<Exclude<EntryStatus, 'retired'>, StatusBadgeStatus> = {
  live: 'supported',
  changed: 'needsValidation',
  new: 'informational',
};

// Retired: an archive box, neutral ink, beside the word.
const RETIRED_ICON = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    aria-hidden="true"
    className="size-3.5 shrink-0"
  >
    <path d="M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3" />
  </svg>
);

/** The entry's status with its icon and word, never colour alone (Retired in neutral ink). */
export function EntryStatusBadge({ status }: { status: EntryStatus }) {
  const t = useTranslations('ops.catalogue.editor.status');
  return status === 'retired' ? (
    <Chip icon={RETIRED_ICON}>{t('retired')}</Chip>
  ) : (
    <StatusBadge status={BADGES[status]} label={t(status)} />
  );
}

/** No draft open: what recruiters see, and "Start a draft". */
export function StartDraft({
  version,
  pending,
  error,
  onStart,
}: {
  version: number;
  pending: boolean;
  error: Refusal | null;
  onStart: () => void;
}) {
  const t = useTranslations('ops.catalogue.editor');
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-body text-text">{t('noDraft', { version })}</p>
      <div>
        <Button variant="primary" onClick={onStart} disabled={pending}>
          {pending ? t('starting') : t('start')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body font-semibold text-err-text">
          <RefusalText error={error} />
        </p>
      )}
    </Card>
  );
}

const summary =
  'flex min-h-10 cursor-pointer flex-wrap items-center gap-2 rounded-control px-2 font-semibold text-text pointer-coarse:min-h-11';

function RetireButton({ name, removable, onRetire }: { name: string; removable: boolean; onRetire: () => void }) {
  const t = useTranslations('ops.catalogue.editor');
  return (
    <Button aria-label={t(removable ? 'removeNamed' : 'retireNamed', { name })} onClick={onRetire}>
      {t(removable ? 'remove' : 'retire')}
    </Button>
  );
}

/** A competency, or a regional hint (no core); its Edit and Retire act on the entry it is. */
function Competency({
  row,
  pack,
  view,
  onEdit,
  onRetire,
}: {
  row: CompetencyRow | HintRow;
  pack: PackRow;
  view: EditorViewModel;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const t = useTranslations('ops.catalogue');
  const labels = (keys: readonly string[]) =>
    keys.map((key) => view.draft.jobTypeEntries.find((j) => j.key === key)?.label ?? key).join(', ');
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-semibold text-text">{row.name}</h3>
        <EntryStatusBadge status={row.status} />
      </div>
      <p className="text-body text-text-2">{row.meaning}</p>
      <p className="flex flex-wrap gap-2">
        <Chip>{t('desirable')}</Chip>
        <Chip>{t('levelNeeded', { level: row.levelNeeded })}</Chip>
      </p>
      <p className="text-meta text-text-2">{t('editor.appliesTo', { jobTypes: labels(row.appliesTo) })}</p>
      {'core' in row && row.core.length > 0 && (
        <p className="text-meta text-text-2">{t('editor.coreFor', { jobTypes: labels(row.core) })}</p>
      )}
      {/* A retired entry stays listed with no controls: it is never deleted (ADR-013 point 6). */}
      {row.status !== 'retired' && pack.status !== 'retired' && (
        <div className="flex flex-wrap gap-2">
          <Button aria-label={t('editor.editNamed', { name: row.name })} onClick={onEdit}>
            {t('editor.edit')}
          </Button>
          <RetireButton name={row.name} removable={row.removable} onRetire={onRetire} />
        </div>
      )}
    </li>
  );
}

/** A pack's regional hints for one region (AIV-P2-046): never a residency rule, always Desirable. */
function RegionHints({ region, pack, view }: { region: RegionRow; pack: PackRow; view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue');
  const hints = pack.hints.filter((h) => h.region === region.key);
  const names = { region: region.key, label: region.label };
  const heading = t('hintsFor', names);
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-3">
      <h3 className="text-body font-semibold text-text">{heading}</h3>
      {pack.status !== 'retired' && region.status !== 'retired' && (
        <div>
          <Button
            aria-label={t('editor.addHintTo', { ...names, name: pack.label })}
            onClick={() => view.onAddHint(pack.key, region.key)}
          >
            {t('editor.addHint')}
          </Button>
        </div>
      )}
      {hints.length === 0 ? (
        <p className="text-body text-text-2">{t('editor.noHints', names)}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {hints.map((row) => (
            <Competency
              key={row.position}
              row={row}
              pack={pack}
              view={view}
              onEdit={() => view.onEditHint(pack.key, row)}
              onRetire={() => void view.onRetireHint(pack.key, row)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A region in the draft (AIV-P2-059): a market, never a residency; a retired one keeps its row with no controls. */
function Region({ row, view }: { row: RegionRow; view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-body font-semibold text-text">{row.label}</h3>
      <span className="font-mono text-meta text-text-2">{row.key}</span>
      <EntryStatusBadge status={row.status} />
      {row.status !== 'retired' && (
        <div className="ms-auto flex flex-wrap gap-2">
          <Button aria-label={t('editNamed', { name: row.label })} onClick={() => view.onEditRegion(row)}>
            {t('edit')}
          </Button>
          <RetireButton name={row.label} removable={row.removable} onRetire={() => void view.onRetireRegion(row.key)} />
        </div>
      )}
    </li>
  );
}

/** A job type in the draft (AIV-P2-047): a retired one keeps its row with no controls. */
function JobType({ row, view }: { row: JobTypeRow; view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue');
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-semibold text-text">{row.label}</h3>
        <span className="font-mono text-meta text-text-2">{row.key}</span>
        <EntryStatusBadge status={row.status} />
      </div>
      <p className="text-meta text-text-2">{t('editor.evidenceIs', { evidence: row.evidence })}</p>
      <p className="text-meta text-text-2">{t('editor.startersAre', { starters: row.starters.join(', ') })}</p>
      {row.status !== 'retired' && (
        <div className="flex flex-wrap gap-2">
          <Button aria-label={t('editor.editNamed', { name: row.label })} onClick={() => view.onEditJobType(row)}>
            {t('editor.edit')}
          </Button>
          <RetireButton
            name={row.label}
            removable={row.status === 'new'}
            onRetire={() => void view.onRetireJobType(row.key)}
          />
        </div>
      )}
    </li>
  );
}

/** The open draft: its banner, every pack with its status and competencies, and the entry forms. */
export function CatalogueEditor({
  publishedVersion,
  view,
  actions,
}: {
  publishedVersion: number;
  view: EditorViewModel;
  /** The banner's Discard and "Review and publish" (AIV-P2-049). */
  actions?: ReactNode;
}) {
  const t = useTranslations('ops.catalogue');
  const formOpen = view.packForm !== null || view.competencyForm !== null || view.jobTypeForm !== null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-strong bg-surface-subtle p-4">
        <p className="text-body font-semibold text-text">{t('editor.banner', { version: publishedVersion })}</p>
        {actions}
      </div>
      {!formOpen && view.error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-body font-semibold text-err-text">
          <RefusalText error={view.error} />
          {view.error.error === 'stale' && <Button onClick={view.onReload}>{t('editor.reload')}</Button>}
        </div>
      )}
      <Card title={t('editor.jobTypes')} level={2}>
        <div className="mb-3">
          <Button onClick={view.onAddJobType}>{t('editor.addJobType')}</Button>
        </div>
        <ol aria-label={t('editor.jobTypes')} className="flex flex-col gap-3">
          {view.draft.jobTypeEntries.map((row) => (
            <JobType key={row.key} row={row} view={view} />
          ))}
        </ol>
      </Card>
      <Card title={t('editor.regions')} level={2}>
        <p className="mb-3 text-meta text-text-2">{t('editor.regionsHint')}</p>
        <div className="mb-3">
          <Button onClick={view.onAddRegion}>{t('editor.addRegion')}</Button>
        </div>
        <ul aria-label={t('editor.regions')} className="flex flex-col gap-3">
          {view.draft.regions.map((row) => (
            <Region key={row.key} row={row} view={view} />
          ))}
        </ul>
      </Card>
      <Card title={t('editor.packs')} level={2}>
        <div className="mb-3">
          <Button onClick={view.onAddPack}>{t('editor.addPack')}</Button>
        </div>
        <ul className="flex flex-col gap-1">
          {view.draft.packs.map((pack) => (
            <li key={pack.key}>
              <details className="rounded-control border border-border">
                <summary className={summary}>
                  {pack.label}
                  <span className="font-mono text-meta font-normal text-text-2">{pack.key}</span>
                  <EntryStatusBadge status={pack.status} />
                  <span className="ms-auto text-meta font-normal text-text-2">
                    {t('competencies', { count: pack.competencies.filter((c) => c.status !== 'retired').length })}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 px-2 pt-2 pb-4">
                  {pack.status !== 'retired' && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        aria-label={t('editor.addCompetencyTo', { name: pack.label })}
                        onClick={() => view.onAddCompetency(pack.key)}
                      >
                        {t('editor.addCompetency')}
                      </Button>
                      <Button
                        aria-label={t('editor.editNamed', { name: pack.label })}
                        onClick={() => view.onEditPack(pack)}
                      >
                        {t('editor.edit')}
                      </Button>
                      <RetireButton
                        name={pack.label}
                        removable={pack.removable}
                        onRetire={() => void view.onRetire(pack.key)}
                      />
                    </div>
                  )}
                  {pack.competencies.length === 0 ? (
                    <p className="text-body text-text-2">{t('editor.noCompetencies')}</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {pack.competencies.map((row) => (
                        <Competency
                          key={row.position}
                          row={row}
                          pack={pack}
                          view={view}
                          onEdit={() => view.onEditCompetency(pack.key, row)}
                          onRetire={() => void view.onRetire(pack.key, row.position)}
                        />
                      ))}
                    </ul>
                  )}
                  {view.draft.regions.map((region) => (
                    <RegionHints key={region.key} region={region} pack={pack} view={view} />
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>
      <JobTypeFormDialog view={view} />
      <PackFormDialog view={view} />
      <CompetencyFormDialog view={view} />
    </div>
  );
}
