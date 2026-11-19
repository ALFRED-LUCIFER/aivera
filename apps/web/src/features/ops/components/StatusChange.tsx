'use client';

import { useTranslations } from '@aivera/i18n/react';
import type { StatusChangeView } from '../domain/workspaces.ts';
import { ReasonedChange } from './ReasonedChange.tsx';

/** Suspend, reactivate, approve or reject one workspace (AIV-P2-037, AIV-P2-039). */
export function StatusChange(view: StatusChangeView) {
  const t = useTranslations('ops.workspaces.change');
  return (
    <ReasonedChange
      labels={{
        open: t(`${view.change}.open`),
        openSuffix: view.name,
        title: t(`${view.change}.title`, { name: view.name }),
        body: t(`${view.change}.body`),
        confirm: t('confirm'),
        pending: t(`${view.change}.pending`),
        cancel: t('cancel'),
        close: t('close'),
        footer: t('footer'),
        failed: t('failed'),
        reason: t('reason'),
        hint: t(`${view.change}.hint`),
      }}
      open={view.open}
      onOpenChange={view.onOpenChange}
      {...(view.needsReason && { reason: { value: view.reason, onChange: view.onReasonChange } })}
      canConfirm={view.canConfirm}
      onConfirm={view.onConfirm}
      done={view.done && t(`${view.done}.done`)}
    />
  );
}
