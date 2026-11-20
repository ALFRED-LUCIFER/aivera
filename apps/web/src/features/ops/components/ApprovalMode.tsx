'use client';

import { useTranslations } from '@credalent/i18n/react';
import { StatusBadge } from '@credalent/ui';
import { useId } from 'react';
import type { ApprovalModeView } from '../domain/workspaces.ts';
import { ReasonedChange } from './ReasonedChange.tsx';

/**
 * "New workspaces need approval": its value, what it means, and turning it off or on with a reason (AIV-P2-039). A
 * strip above the list, not a card of its own: it is the page's one setting.
 */
export function ApprovalMode(view: ApprovalModeView) {
  const t = useTranslations('ops.approvals.mode');
  const c = useTranslations('ops.workspaces.change');
  const next = view.required ? 'off' : 'on';
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-border bg-surface p-4 shadow-1"
    >
      <div className="flex min-w-0 grow flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id={titleId} className="text-card text-text">
            {t('title')}
          </h2>
          <StatusBadge
            status={view.required ? 'supported' : 'informational'}
            label={view.required ? t('on') : t('off')}
          />
        </div>
        <p className="text-body text-text-2">{view.required ? t('onState') : t('offState')}</p>
      </div>
      <ReasonedChange
        labels={{
          open: view.required ? t('turnOff') : t('turnOn'),
          title: t(`${next}Title`),
          body: t(`${next}Body`),
          confirm: c('confirm'),
          pending: t('pending'),
          cancel: c('cancel'),
          close: c('close'),
          footer: c('footer'),
          failed: c('failed'),
          reason: c('reason'),
        }}
        open={view.open}
        onOpenChange={view.onOpenChange}
        reason={{ value: view.reason, onChange: view.onReasonChange, hint: t('hint') }}
        canConfirm={view.canConfirm}
        onConfirm={view.onConfirm}
        done={view.done === null ? null : view.done ? t('doneOn') : t('doneOff')}
      />
    </section>
  );
}
