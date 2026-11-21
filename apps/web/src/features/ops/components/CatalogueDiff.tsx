'use client';

import { useTranslations } from '@credalent/i18n/react';
import type { CatalogueChange, DiffGroup } from '@credalent/jobs';

// The grouped catalogue diff (AIV-P2-049): the publish preview's list, and a published version's changes (AIV-P2-050).

const GROUPS: readonly DiffGroup[] = ['jobTypes', 'regions', 'packs', 'competencies', 'hints'];

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

/** Every change against the version before, grouped; each line says what it does in words. */
export function CatalogueDiff({ changes }: { changes: readonly CatalogueChange[] }) {
  const t = useTranslations('ops.catalogue.editor.diff');
  if (changes.length === 0) return <p>{t('none')}</p>;
  return (
    <div className="flex flex-col gap-3">
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
