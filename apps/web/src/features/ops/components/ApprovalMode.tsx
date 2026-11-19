'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Card, StatusBadge } from '@aivera/ui';
import type { ApprovalModeView } from '../domain/workspaces.ts';
import { ReasonedChange } from './ReasonedChange.tsx';

/** "New workspaces need approval": its value, and turning it off or on with a reason (AIV-P2-039). */
export function ApprovalMode(view: ApprovalModeView) {
  const t = useTranslations('ops.approvals.mode');
  const c = useTranslations('ops.workspaces.change');
  const next = view.required ? 'off' : 'on';
  return (
    <Card title={t('title')} level={2}>
      <div className="flex flex-col gap-4">
        <div>
          <StatusBadge
            status={view.required ? 'supported' : 'informational'}
            label={view.required ? t('on') : t('off')}
          />
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
      </div>
    </Card>
  );
}
