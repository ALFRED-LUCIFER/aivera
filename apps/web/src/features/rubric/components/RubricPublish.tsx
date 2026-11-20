'use client';

import { useTranslations } from '@credalent/i18n/react';
import { PUBLIC_DESCRIPTOR_MAX } from '@credalent/jobs';
import { Button, buttonClassName, Card, Input, Label, PreviewBanner, StatusBadge, SuccessBanner } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
import { publicListingPath, type PublicationView, type PublishView } from '../domain/rubric.ts';

type Props = { publication: PublicationView; publish: PublishView };

// Stable, so focus moves once, when the button replaces the preview it opened.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

/**
 * "Publish on Credalent jobs" on the rubric page (Rubric artboard, AIV-P1-015): not published, the preview of what
 * candidates see and what stays hidden, then published with "View public listing" and "Unpublish". Deviations: the
 * preview asks how candidates see the employer ("A BNPL fintech"), which the listing needs and the artboard omits; it is
 * the shared PreviewBanner (AGENTS.md 4: the preview-confirm card, with its "Nothing changes until you confirm."
 * footer), with paragraphs for its lines and 40 px buttons (the standard target) instead of the artboard's small ones.
 */
export function RubricPublish({ publication, publish }: Props) {
  const t = useTranslations('rubric.publish');
  const descriptorId = useId();
  const hintId = useId();
  const reasonId = useId();
  const descriptor = publish.descriptor.trim();

  return (
    <Card title={t('title')} level={2}>
      <div className="flex flex-col gap-3">
        {/* Mounted empty with the panel, so the message after a change is announced (SuccessBanner). */}
        <SuccessBanner>
          {publish.status === 'unpublished' ? t('unpublished') : publish.status === 'published' ? t('live') : null}
        </SuccessBanner>
        {publication.published ? (
          <>
            <p className="flex flex-col items-start gap-1">
              <StatusBadge status="supported" label={t('published')} />
              <span className="sr-only">{t('separator')}</span>
              <span className="text-meta text-text-2">{t('live')}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {publication.slug && (
                <Link href={publicListingPath(publication.slug) as Route} className={buttonClassName('secondary')}>
                  {t('view')}
                </Link>
              )}
              <Button variant="ghost" disabled={publish.pending} onClick={publish.onUnpublish}>
                {t('unpublish')}
              </Button>
            </div>
          </>
        ) : publish.previewing ? (
          <PreviewBanner
            title={t('previewTitle')}
            consequence={t('inbox')}
            confirmLabel={t('confirm')}
            pendingLabel={t('publishing')}
            confirmDisabled={!descriptor || descriptor.length > PUBLIC_DESCRIPTOR_MAX}
            cancelLabel={t('cancel')}
            footer={t('footer')}
            errorMessage={
              publish.status === 'descriptor' ? t('descriptorError', { max: PUBLIC_DESCRIPTOR_MAX }) : t('failed')
            }
            onConfirm={publish.onPublish}
            onCancel={publish.onCancel}
          >
            <p>{t('shown', { count: publication.competencies })}</p>
            <p className="mt-2">{t('hidden')}</p>
            <div className="mt-3 flex flex-col gap-1">
              <Label htmlFor={descriptorId}>{t('descriptorLabel')}</Label>
              <Input
                id={descriptorId}
                aria-describedby={hintId}
                value={publish.descriptor}
                maxLength={PUBLIC_DESCRIPTOR_MAX}
                onChange={(e) => publish.onDescriptor(e.target.value)}
              />
              <span id={hintId} className="text-meta text-text-2">
                {t('descriptorHint', { max: PUBLIC_DESCRIPTOR_MAX })}
              </span>
            </div>
          </PreviewBanner>
        ) : (
          <>
            <p className="text-text-2">{t('notPublished')}</p>
            <div className="flex flex-col gap-1">
              <Button
                ref={publish.returnFocus ? focusOnMount : undefined}
                className="self-start"
                disabled={!publication.approved}
                aria-describedby={publication.approved ? undefined : reasonId}
                onClick={publish.onPreview}
              >
                {t('publish')}
              </Button>
              {!publication.approved && (
                <span id={reasonId} className="text-meta text-text-2">
                  {t('needsApproval')}
                </span>
              )}
            </div>
          </>
        )}
        {publish.status === 'failed' && !publish.previewing && (
          <p role="alert" className="rounded-control border border-err-border bg-err-bg p-3 text-err-text">
            {t('failed')}
          </p>
        )}
      </div>
    </Card>
  );
}
