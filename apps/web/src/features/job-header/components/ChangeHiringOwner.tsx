'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Label, PreviewConfirmCard, Select, SuccessBanner, Textarea } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
import { REASON_MAX, type ChangeOwnerView, type OwnerOption } from '../domain/hiringOwner.ts';

const MEMBERS = '/app/settings/members' as Route;

/**
 * The admin's control in the job header's meta line (AIV-P1-097): "Assign one" while the job has no hiring owner,
 * "Change hiring owner" otherwise. It opens the shared preview-confirm card with the active hiring-owner members, a
 * required reason, and the access that will be granted and revoked.
 * Deviation from the ticket's "loading state": the members arrive with the page, so the dialog never waits on a load.
 */
export function ChangeHiringOwner({
  view,
  options,
  hasOwner,
  jobTitle,
}: {
  view: ChangeOwnerView;
  options: OwnerOption[];
  hasOwner: boolean;
  jobTitle: string;
}) {
  const t = useTranslations('jobHeader.owner');
  const pickId = useId();
  const reasonId = useId();
  return (
    <>
      <PreviewConfirmCard
        title={t(hasOwner ? 'changeTitle' : 'assignTitle')}
        trigger={<Button variant="secondary">{t(hasOwner ? 'change' : 'assignOne')}</Button>}
        open={view.open}
        onOpenChange={view.onOpenChange}
        closeLabel={t('close')}
        confirmLabel={t('confirm')}
        pendingLabel={t('pending')}
        cancelLabel={t('cancel')}
        footer={t('footer')}
        errorMessage={t('failed')}
        confirmDisabled={!view.canConfirm}
        onConfirm={view.onConfirm}
        onCancel={() => {}}
      >
        {options.length === 0 ? (
          <p>
            {t('empty')}{' '}
            <Link href={MEMBERS} className="underline underline-offset-2">
              {t('membersLink')}
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={pickId}>{t('pick')}</Label>
              <Select id={pickId} value={view.ownerId} onChange={(event) => view.onOwnerChange(event.target.value)}>
                <option value="">{t('pickPlaceholder')}</option>
                {options.map((option) => (
                  <option key={option.userId} value={option.userId}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId}>{t('reason')}</Label>
              <Textarea
                id={reasonId}
                required
                maxLength={REASON_MAX}
                rows={3}
                value={view.reason}
                onChange={(event) => view.onReasonChange(event.target.value)}
              />
            </div>
            {view.preview.gains && (
              <ul className="list-disc ps-5">
                <li>{t('gains', { name: view.preview.gains, job: jobTitle })}</li>
                {view.preview.loses && <li>{t('loses', { name: view.preview.loses, job: jobTitle })}</li>}
              </ul>
            )}
          </div>
        )}
      </PreviewConfirmCard>
      <SuccessBanner>{view.done && t('done')}</SuccessBanner>
    </>
  );
}
