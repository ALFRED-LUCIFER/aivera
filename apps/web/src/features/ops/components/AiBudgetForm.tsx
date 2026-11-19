'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Button, Input, Label, PreviewConfirmCard, SuccessBanner, Textarea } from '@aivera/ui';
import { AI_DAILY_TOKEN_BUDGET, type AiBudgetView } from '../domain/aiBudget.ts';

const BUDGET_INPUT = 'ops-ai-budget';
const bounds = { min: AI_DAILY_TOKEN_BUDGET.min, max: AI_DAILY_TOKEN_BUDGET.max };

/**
 * Sets the workspace's daily AI budget, or resets it to the platform default, with a reason (AIV-P2-038). The change
 * is shown in the shared preview and applied only on Confirm (AGENTS.md 1.5).
 */
export function AiBudgetForm({ overridden, view }: { overridden: boolean; view: AiBudgetView }) {
  const t = useTranslations('ops.workspaces.ai');
  const { error, preview } = view;
  const described = (field: 'bounds' | 'reason', hint?: string) =>
    [hint, error === field ? `${BUDGET_INPUT}-${field}-error` : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <section aria-labelledby={`${BUDGET_INPUT}-title`} className="mt-6 flex max-w-xl flex-col gap-3">
      <h3 id={`${BUDGET_INPUT}-title`} className="text-card text-text">
        {t('change')}
      </h3>
      <SuccessBanner>
        {view.saved !== undefined && (view.saved === null ? t('savedDefault') : t('saved', { budget: view.saved }))}
      </SuccessBanner>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          view.onPreview();
        }}
      >
        <Label htmlFor={BUDGET_INPUT}>{t('newBudget')}</Label>
        <Input
          id={BUDGET_INPUT}
          inputMode="numeric"
          autoComplete="off"
          value={view.budget}
          onChange={(event) => view.onBudgetChange(event.target.value)}
          aria-invalid={error === 'bounds' || undefined}
          aria-describedby={described('bounds', `${BUDGET_INPUT}-hint`)}
        />
        <p id={`${BUDGET_INPUT}-hint`} className="text-meta text-text-2">
          {t('hint', bounds)}
        </p>
        {error === 'bounds' && (
          <p id={`${BUDGET_INPUT}-bounds-error`} role="alert" className="text-meta font-semibold text-err-text">
            {t('bounds', bounds)}
          </p>
        )}
        <Label htmlFor={`${BUDGET_INPUT}-reason`}>{t('reason')}</Label>
        <Textarea
          id={`${BUDGET_INPUT}-reason`}
          rows={2}
          maxLength={500}
          aria-required="true"
          value={view.reason}
          onChange={(event) => view.onReasonChange(event.target.value)}
          aria-invalid={error === 'reason' || undefined}
          aria-describedby={described('reason')}
        />
        {error === 'reason' && (
          <p id={`${BUDGET_INPUT}-reason-error`} role="alert" className="text-meta font-semibold text-err-text">
            {t('reasonRequired')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary">
            {t('preview')}
          </Button>
          {overridden && (
            <Button type="button" onClick={view.onPreviewReset}>
              {t('reset')}
            </Button>
          )}
        </div>
      </form>
      <PreviewConfirmCard
        open={preview !== null}
        onOpenChange={(open) => !open && view.onCancel()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(BUDGET_INPUT)?.focus();
        }}
        title={t('previewTitle')}
        consequence={t('consequence')}
        confirmLabel={t('confirm')}
        pendingLabel={t('pending')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        footer={t('footer')}
        errorMessage={t('failed')}
        onConfirm={view.onConfirm}
        onCancel={view.onCancel}
      >
        {preview && t(preview.reset ? 'previewReset' : 'previewBody', { from: preview.from, to: preview.to })}
      </PreviewConfirmCard>
    </section>
  );
}
