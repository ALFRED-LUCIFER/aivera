'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Button, Label, PreviewConfirmCard, SuccessBanner, Textarea } from '@aivera/ui';
import { useId } from 'react';
import type { StatusChangeView } from '../domain/workspaces.ts';

/** "Suspend workspace" or "Reactivate", on the shared preview-confirm card with a required reason (AIV-P2-037). */
export function StatusChange(view: StatusChangeView) {
  const t = useTranslations('ops.workspaces.change');
  const reasonId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-3">
      <PreviewConfirmCard
        title={t(`${view.change}.title`, { name: view.name })}
        trigger={<Button className="self-start">{t(`${view.change}.open`)}</Button>}
        open={view.open}
        onOpenChange={view.onOpenChange}
        closeLabel={t('close')}
        confirmLabel={t('confirm')}
        pendingLabel={t(`${view.change}.pending`)}
        cancelLabel={t('cancel')}
        footer={t('footer')}
        errorMessage={t('failed')}
        confirmDisabled={!view.canConfirm}
        onConfirm={view.onConfirm}
        onCancel={() => {}}
      >
        <p>{t(`${view.change}.body`)}</p>
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor={reasonId}>{t('reason')}</Label>
          <Textarea
            id={reasonId}
            aria-describedby={hintId}
            required
            maxLength={500}
            rows={3}
            value={view.reason}
            onChange={(e) => view.onReasonChange(e.target.value)}
          />
          <p id={hintId} className="text-meta text-text-2">
            {t('reasonHint')}
          </p>
        </div>
      </PreviewConfirmCard>
      <SuccessBanner>{view.done && t(`${view.done}.done`)}</SuccessBanner>
    </div>
  );
}
