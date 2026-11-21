'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, Chip, StatusBadge, type StatusBadgeStatus } from '@credalent/ui';
import type { CompetencyRow, EditorViewModel, EntryStatus, PackRow, Refusal } from '../domain/catalogueEditor.ts';
import { CompetencyFormDialog, PackFormDialog, RefusalText } from './CatalogueForms.tsx';

/*
 * The catalogue editor (AIV-P2-045), from the console spec's catalogue editor layout (operator-console.md); there is no
 * artboard for it. Deviations, each for a later ticket: the banner has no Discard or "Review and publish" yet
 * (AIV-P2-049), so the page has no primary button outside a form; entries are grouped by pack only, since job types and
 * regional hints are edited in AIV-P2-047 and AIV-P2-046; the entry form opens in a dialog rather than in the main
 * column, so the long pack list keeps its place.
 */

const BADGES: Record<Exclude<EntryStatus, 'retired'>, StatusBadgeStatus> = {
  live: 'supported',
  changed: 'needsValidation',
  new: 'informational',
};

/** The entry's status with its icon and word, never colour alone; Retired is a plain word. */
export function EntryStatusBadge({ status }: { status: EntryStatus }) {
  const t = useTranslations('ops.catalogue.editor.status');
  return status === 'retired' ? <Chip>{t('retired')}</Chip> : <StatusBadge status={BADGES[status]} label={t(status)} />;
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

function Competency({ row, pack, view }: { row: CompetencyRow; pack: PackRow; view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue');
  const labels = (keys: readonly string[]) =>
    keys.map((key) => view.draft.jobTypes.find((j) => j.key === key)?.label ?? key).join(', ');
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
      {row.core.length > 0 && (
        <p className="text-meta text-text-2">{t('editor.coreFor', { jobTypes: labels(row.core) })}</p>
      )}
      {/* A retired entry stays listed with no controls: it is never deleted (ADR-013 point 6). */}
      {row.status !== 'retired' && pack.status !== 'retired' && (
        <div className="flex flex-wrap gap-2">
          <Button
            aria-label={t('editor.editNamed', { name: row.name })}
            onClick={() => view.onEditCompetency(pack.key, row)}
          >
            {t('editor.edit')}
          </Button>
          <RetireButton
            name={row.name}
            removable={row.removable}
            onRetire={() => void view.onRetire(pack.key, row.position)}
          />
        </div>
      )}
    </li>
  );
}

/** The open draft: its banner, every pack with its status and competencies, and the entry forms. */
export function CatalogueEditor({ publishedVersion, view }: { publishedVersion: number; view: EditorViewModel }) {
  const t = useTranslations('ops.catalogue');
  const formOpen = view.packForm !== null || view.competencyForm !== null;
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-card border border-border-strong bg-surface-subtle p-4 text-body font-semibold text-text">
        {t('editor.banner', { version: publishedVersion })}
      </p>
      {!formOpen && view.error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-body font-semibold text-err-text">
          <RefusalText error={view.error} />
          {view.error.error === 'stale' && <Button onClick={view.onReload}>{t('editor.reload')}</Button>}
        </div>
      )}
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
                    {t('competencies', { count: pack.competencies.length })}
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
                        <Competency key={row.position} row={row} pack={pack} view={view} />
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>
      <PackFormDialog view={view} />
      <CompetencyFormDialog view={view} />
    </div>
  );
}
