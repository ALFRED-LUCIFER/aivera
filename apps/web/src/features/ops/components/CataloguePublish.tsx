'use client';

import { useTranslations } from '@credalent/i18n/react';
import type { CataloguePublishViewModel } from '../domain/cataloguePublish.ts';
import { CatalogueDiff } from './CatalogueDiff.tsx';
import { ReasonedChange } from './ReasonedChange.tsx';

/*
 * "Review and publish" and "Discard draft" in the draft banner (AIV-P2-049), from the console spec's catalogue editor
 * layout (operator-console.md); there is no artboard. Both open the shared preview-confirm card. Deviation: the card
 * shows the eval's state as one line under the diff, not its full result, which the eval panel on the page shows.
 */

export function CataloguePublish({ model }: { model: CataloguePublishViewModel }) {
  const t = useTranslations('ops.catalogue.editor');
  const { version, publishedVersion, publish, discard } = model;
  // A stale card names what to do; any other refusal says which rule refused it (the server re-checks every one).
  const failed = (error: CataloguePublishViewModel['publish']['error']) => {
    if (!error) return t('errors.failed');
    if (error.error === 'stale' || error.error === 'no_draft') return t('publish.stale');
    return error.error === 'invalid' ? t('errors.invalid.other') : t(`errors.${error.error}`);
  };
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
          failed: failed(discard.error),
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
        {/* No scroll box of its own: the dialog scrolls, so a long diff stays reachable by keyboard (axe). */}
        <div className="mt-3">
          <CatalogueDiff changes={model.changes} />
        </div>
        {publish.block && <p className="mt-3 font-semibold">{t(`publish.blocked.${publish.block}`)}</p>}
      </ReasonedChange>
    </div>
  );
}
