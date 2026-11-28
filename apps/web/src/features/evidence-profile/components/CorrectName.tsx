'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Dialog, Input, Label, Textarea } from '@credalent/ui';
import { useId } from 'react';
import { NAME_MAX, NAME_REASON_MAX, type NameView } from '../domain/name.ts';

// AIV-P1-165 §8: "Correct name" beside the candidate's name. The Candidate artboard
// (docs/01-design/artboards/Candidate.dc.html) draws no such control: a name read wrongly from a CV is the ticket's
// finding. The shared Dialog with the shared fields, a secondary trigger, and Save as the dialog's one primary button.

export function CorrectName({ view }: { view: NameView }) {
  const t = useTranslations('candidateProfile.name');
  const id = useId();
  return (
    <Dialog
      open={view.open}
      onOpenChange={view.onOpenChange}
      title={t('title')}
      description={t('description')}
      closeLabel={t('close')}
      closeDisabled={view.pending}
      trigger={<Button size="compact">{t('open')}</Button>}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (view.valid) view.onSave();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-name`}>{t('label')}</Label>
          <Input
            id={`${id}-name`}
            required
            maxLength={NAME_MAX}
            // The browser offers nothing it remembers: a candidate's name is not kept in its form history (AGENTS.md 1.2).
            autoComplete="off"
            value={view.name}
            onChange={(event) => view.onNameChange(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
          <Textarea
            id={`${id}-reason`}
            required
            rows={2}
            maxLength={NAME_REASON_MAX}
            value={view.reason}
            onChange={(event) => view.onReasonChange(event.target.value)}
          />
        </div>
        {view.failed && (
          <p role="alert" className="text-meta font-semibold text-err-text">
            {t('failed')}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={() => view.onOpenChange(false)} disabled={view.pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={view.pending || !view.valid}>
            {view.pending ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
