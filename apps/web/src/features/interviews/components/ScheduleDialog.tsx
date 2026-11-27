'use client';

// AIV-P2-007: give an interview its time and interviewer. No artboard draws this dialog (the Message artboard draws the
// later invitation email); it follows the ticket's fields with the shared Dialog and fields. Deviations from the ticket:
// - the round and competencies are shown, not edited: "Choose for interview" (AIV-P1-114) set them from the gaps, and
//   the scheduling command changes only the time and interviewer;
// - no "Send invitation" and no drafted email: the candidate's invitation (with its "delete my data" link) and the
//   interviewer's calendar file are follow-up tickets (owner decision, 27 Nov 2026), so the dialog says nobody is
//   contacted, and saving is the "Not now" path of the ticket;
// - interviewers are every active member; the server refuses one the job does not grant, with its reason.
import { useTranslations } from '@credalent/i18n/react';
import { Button, Dialog, Input, Label, Select } from '@credalent/ui';
import { useId } from 'react';
import type { ScheduleView } from '../domain/schedule.ts';

export function ScheduleDialog({ view }: { view: ScheduleView }) {
  const t = useTranslations('interviews');
  const id = useId();
  const { row } = view;
  const errorId = `${id}-error`;
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) view.onClose();
      }}
      title={row ? t('schedule.title', { round: t(`round.${row.round}`) }) : ''}
      description={row ? t('schedule.description', { name: row.candidate ?? t('unnamed'), job: row.job }) : undefined}
      closeLabel={t('schedule.close')}
      closeDisabled={view.pending}
    >
      {row && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void view.onSave();
          }}
          aria-describedby={view.error ? errorId : undefined}
        >
          {row.competencies.length > 0 && (
            <p className="text-meta text-text-2">{t('schedule.competencies', { list: row.competencies.join(', ') })}</p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-interviewer`}>{t('schedule.interviewer')}</Label>
            <Select
              id={`${id}-interviewer`}
              value={view.interviewerUserId}
              onChange={(event) => view.onInterviewerChange(event.target.value)}
            >
              <option value="">{t('schedule.chooseInterviewer')}</option>
              {view.interviewers.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-date`}>{t('schedule.date')}</Label>
              <Input
                id={`${id}-date`}
                type="date"
                value={view.date}
                onChange={(event) => view.onDateChange(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-time`}>{t('schedule.time', { timeZone: view.timeZone })}</Label>
              <Input
                id={`${id}-time`}
                type="time"
                value={view.time}
                onChange={(event) => view.onTimeChange(event.target.value)}
              />
            </div>
          </div>
          <p className="text-meta text-text-2">{t('schedule.noContact')}</p>
          {view.error && (
            <p id={errorId} role="alert" className="text-meta font-semibold text-err-text">
              {t(`schedule.errors.${view.error}`)}
            </p>
          )}
          {view.clashAt && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-warn-border bg-warn-bg p-3 text-warn-text"
            >
              <p className="flex items-start gap-2 text-meta font-semibold">
                <WarnIcon />
                {t('schedule.clash', { at: new Date(view.clashAt) })}
              </p>
              <Button
                type="button"
                onClick={() => void view.onSave(true)}
                disabled={view.pending}
                className="self-start"
              >
                {t('schedule.keep')}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" onClick={view.onClose} disabled={view.pending}>
              {t('schedule.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={view.pending}>
              {view.pending ? t('schedule.saving') : t('schedule.save')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function WarnIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-0.5 size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2.5 14 13H2zM8 6.5v3m0 1.75v.25" />
    </svg>
  );
}
