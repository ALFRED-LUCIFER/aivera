'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, Label, PreviewBanner, SegmentedControl, SuccessBanner, Textarea } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { DECISIONS, NOTE_MAX, type DecisionValue, type PackPage, type RecordView } from '../domain/pack.ts';

// AIV-P2-012: "Record the decision" on the Pack artboard (docs/01-design/artboards/Pack.dc.html), ported as its own
// card (the shared Card) under the members. Deviations:
// - each member's choice is the shared SegmentedControl (a radio group named "Your decision for <name>"), not three
//   toggle buttons, and nothing is chosen at first: Credalent's recommendation decides nothing (AGENTS.md 1.5);
// - that group has a visible legend, "Your decision for <name>", where the artboard has an aria-label only, and it sits
//   on its own ruled-off row at the foot of the member's card, not on the row of "Credalent's recommendation: …": the
//   recommendation belongs to the cited summary, with its sources under it (AIV-P2-011), and the person's decision must
//   never read as Credalent's (AGENTS.md 1.5), so the two are labelled and kept apart; a member still being summarised,
//   or with no summary, has no recommendation row to share;
// - the cards' padding is the shared Card's 16 px, not 24 px, as for the rest of the pack (AIV-P2-010);
// - the lead is the ticket's ("updates stages in Credalent only. No candidate is contacted until you send a message
//   yourself"), and the confirmation offers "Schedule Round 2 interviews", not the artboard's "3 decision emails are
//   ready. Review and send them": decision email drafts are AIV-P2-073 (#515), which changes this copy with them;
// - "Record decisions" opens the shared preview-confirm banner ("Nothing changes until you confirm.") with each
//   decision, the stage it leads to and a required reason, written to each decision's audit entry (AGENTS.md 1.5: who,
//   when and why); the artboard records at once and asks for no reason;
// - "Back to ranking" stays at the foot of the pack, where AIV-P2-010 put it, not beside "Record decisions";
// - a recruiter, an admin or another hiring owner sees the choices read-only with "Only the hiring owner can record
//   decisions"; a decided pack shows them read-only with who recorded them and when (the ticket's scenarios).

const focusOnMount = (element: HTMLElement | null) => element?.focus();

/** One member's decision: chosen by the hiring owner, or read-only (recorded, or anyone else). */
export function DecisionChoice({
  member,
  name,
  record,
  readOnly,
}: {
  member: PackPage['members'][number];
  name: string;
  record: RecordView | undefined;
  readOnly: boolean;
}) {
  const t = useTranslations('decisionPack.record');
  const errorId = useId();
  const missing = record?.missing.includes(member.candidateId) ?? false;
  const value = member.decision ?? record?.choices[member.candidateId];
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <SegmentedControl
        legend={t('legend', { name })}
        options={DECISIONS.map((decision) => ({ value: decision, label: t(`options.${decision}`) }))}
        // '' checks no option: the group stays controlled before anything is chosen.
        value={value ?? ''}
        disabled={readOnly || !record}
        onValueChange={(decision) => record?.onChoose(member.candidateId, decision as DecisionValue)}
        aria-invalid={missing}
        {...(missing && { 'aria-describedby': errorId })}
      />
      {missing && (
        <p id={errorId} role="alert" className="text-meta text-err-text">
          {t('choose', { name })}
        </p>
      )}
    </div>
  );
}

/** "Record the decision": the hiring owner's one primary action, its preview, and what happened after. */
export function RecordSection({
  pack,
  record,
  names,
}: {
  pack: PackPage;
  record: RecordView | undefined;
  /** Each member's name by candidate id, as the cards show it. */
  names: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('decisionPack.record');
  const tStage = useTranslations('ranking.stages');
  const reasonId = useId();
  const reasonErrorId = useId();
  const schedule = (
    // jobPageHref builds the path from the job id, which typed routes cannot check.
    <Link href={jobPageHref(pack.jobId, 'interviews') as Route} className="underline underline-offset-2">
      {t('schedule')}
    </Link>
  );
  const recordedAt = record?.recordedAt ?? null;
  return (
    <section aria-labelledby="record-title">
      <Card>
        <div className="flex flex-col gap-3">
          <h3 id="record-title" className="text-section text-text">
            {t('title')}
          </h3>
          {pack.mayDecide && (
            // Mounted empty first, so the confirmation is announced when it arrives.
            <SuccessBanner>
              {recordedAt && (
                <>
                  {t('done', { date: recordedAt })} {schedule}
                </>
              )}
            </SuccessBanner>
          )}
          {recordedAt ? null : pack.decided ? (
            <p className="text-body text-text">
              {pack.decided.by
                ? t('recorded', { name: pack.decided.by, date: pack.decided.at })
                : t('recordedUnknown', { date: pack.decided.at })}{' '}
              {schedule}
            </p>
          ) : !pack.mayDecide || !record ? (
            <p className="text-body text-text">{t('onlyOwner')}</p>
          ) : (
            <>
              <p className="max-w-[72ch] text-body text-text-2">{t('lead')}</p>
              {record.previewing ? (
                <PreviewBanner
                  title={t('preview.title', { count: pack.members.length })}
                  consequence={t('preview.consequence')}
                  confirmLabel={t('preview.confirm', { count: pack.members.length })}
                  pendingLabel={t('preview.pending')}
                  confirmDisabled={!record.reasonValid}
                  cancelLabel={t('preview.cancel')}
                  footer={t('preview.footer')}
                  errorMessage={t(record.error === 'decided' ? 'preview.decided' : 'preview.failed')}
                  onConfirm={record.onConfirm}
                  onCancel={record.onCancel}
                >
                  <ul className="flex flex-col divide-y divide-border">
                    {pack.members.map((m) => {
                      const decision = record.choices[m.candidateId];
                      return (
                        <li key={m.candidateId} className="flex flex-col gap-1 py-2">
                          <span className="font-semibold">{names.get(m.candidateId)}</span>
                          <span className="text-meta text-text-2">
                            {decision === 'advance'
                              ? t('preview.stage', {
                                  decision: t('options.advance'),
                                  stage: tStage('round2_shortlist'),
                                })
                              : decision === 'do_not_advance'
                                ? t('preview.stage', {
                                    decision: t('options.do_not_advance'),
                                    stage: tStage('not_advanced'),
                                  })
                                : t('preview.hold')}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3 flex flex-col gap-1.5">
                    <Label htmlFor={reasonId}>{t('preview.reason')}</Label>
                    <Textarea
                      ref={focusOnMount}
                      id={reasonId}
                      required
                      rows={2}
                      maxLength={NOTE_MAX}
                      aria-invalid={!record.reasonValid || undefined}
                      aria-describedby={record.reasonValid ? undefined : reasonErrorId}
                      value={record.reason}
                      onChange={(event) => record.onReasonChange(event.target.value)}
                    />
                    {!record.reasonValid && (
                      <span id={reasonErrorId} className="text-meta text-err-text">
                        {t('preview.reasonRequired')}
                      </span>
                    )}
                  </div>
                </PreviewBanner>
              ) : (
                <Button variant="primary" className="self-start" onClick={record.onRecord}>
                  {t('submit')}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </section>
  );
}
