'use client';

import { useTranslations } from '@credalent/i18n/react';
import type { CatalogueChange, DiffGroup } from '@credalent/jobs';
import type { CataloguePublishViewModel } from '../domain/cataloguePublish.ts';
import { ReasonedChange } from './ReasonedChange.tsx';

/*
 * "Review and publish" and "Discard draft" in the draft banner (AIV-P2-049), from the console spec's catalogue editor
 * layout (operator-console.md); there is no artboard. Both open the shared preview-confirm card. Deviation: the card
 * shows the eval's state as one line under the diff, not its full result, which the eval panel on the page shows.
 */

const GROUPS: readonly DiffGroup[] = ['jobTypes', 'packs', 'competencies', 'hints'];

function ChangeLines({ change }: { change: CatalogueChange }) {
  const t = useTranslations('ops.catalogue.editor.diff');
  if (change.kind !== 'edited') return <li>{t(change.kind, { name: change.name })}</li>;
  return change.fields.map(({ field, before, after }) => (
    <li key={field}>
      {change.name
        ? t('edited', { name: change.name, field: t(`fields.${field}`), before, after })
        : t('editedUnnamed', { field: t(`fields.${field}`), before, after })}
    </li>
  ));
}

/** Every change against the published version, grouped; each line says what it does in words. */
function Diff({ changes }: { changes: readonly CatalogueChange[] }) {
  const t = useTranslations('ops.catalogue.editor.diff');
  if (changes.length === 0) return <p className="mt-3">{t('none')}</p>;
  return (
    <div className="mt-3 flex max-h-80 flex-col gap-3 overflow-y-auto">
      {GROUPS.map((group) => {
        const rows = changes.filter((c) => c.group === group);
        return (
          rows.length > 0 && (
            <section key={group} className="flex flex-col gap-1">
              <h3 className="text-body font-semibold text-text">{t(`groups.${group}`)}</h3>
              <ul className="flex flex-col gap-1 text-body text-text">
                {rows.map((change) => (
                  <ChangeLines key={change.id} change={change} />
                ))}
              </ul>
            </section>
          )
        );
      })}
    </div>
  );
}

export function CataloguePublish({ model }: { model: CataloguePublishViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  const { version, publishedVersion, publish, discard } = model;
  const failed = (error: CataloguePublishViewModel['publish']['error']) =>
    t(error?.error === 'stale' || error?.error === 'no_draft' ? 'publish.stale' : 'errors.failed');
  const common = { cancel: t('cancel'), close: t('close'), footer: t('publish.footer') };
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ReasonedChange
        labels={{
          ...common,
          open: t('discard.open'),
          title: t('discard.title', { version }),
          body: t('discard.body', { version: publishedVersion }),
          confirm: t('discard.confirm'),
          pending: t('discard.pending'),
          failed: discard.error?.error === 'eval_running' ? t('errors.eval_running') : failed(discard.error),
          reason: '',
        }}
        open={discard.open}
        onOpenChange={discard.onOpenChange}
        canConfirm
        onConfirm={discard.onConfirm}
        done={null}
      />
      <ReasonedChange
        primary
        labels={{
          ...common,
          open: t('publish.open'),
          title: t('publish.title', { version }),
          body: t('publish.body', { version }),
          confirm: t('publish.confirm', { version }),
          pending: t('publish.pending'),
          failed: failed(publish.error),
          reason: t('publish.reason'),
        }}
        open={publish.open}
        onOpenChange={publish.onOpenChange}
        reason={{ value: publish.reason, onChange: publish.onReasonChange, hint: t('publish.reasonHint') }}
        canConfirm={publish.block === null}
        onConfirm={publish.onConfirm}
        done={null}
      >
        <Diff changes={model.changes} />
        {publish.block && <p className="mt-3 font-semibold">{t(`publish.blocked.${publish.block}`)}</p>}
      </ReasonedChange>
    </div>
  );
}
