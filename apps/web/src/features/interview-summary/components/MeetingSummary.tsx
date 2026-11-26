'use client';

import { useTranslations } from '@credalent/i18n/react';
import { SUMMARY_MAX_CHARS, type SummaryPreview } from '@credalent/interviews';
import {
  Button,
  Card,
  Checkbox,
  EvidenceHighlight,
  Label,
  PreviewBanner,
  SuccessBanner,
  Textarea,
  ValueBasis,
} from '@credalent/ui';
import type { SummaryErrorKey, SummaryPanel, SummaryProposal } from '../domain/summary.ts';

// AIV-P1-115: the "Meeting summary" panel at the foot of the interview scorecard's left column.
// The summary box has no artboard (the ticket lists it); the preview is the shared preview-confirm card, and its
// wording ("<Competency>: Supporting to Medium", "Backed score 55 to 61", "logged with your name, the time and your
// note") is the Interview artboard's "Effect on the assessment" card (docs/01-design/artboards/Interview.dc.html).
// Deviations, each for the ticket, a rule or the shared components:
// - the box, its count, its note and "Analyse summary" are drawn from the scorecard's own note field (Label, Textarea,
//   meta text): there is no artboard to port;
// - "Analyse summary" is a default button, not a primary one: the page's primary button is "Submit scorecard", and
//   while the preview card is open its "Apply" is, with "Submit scorecard" a default button (one primary button per
//   view, DESIGN.md);
// - "Effect on the assessment" is the preview card's title, inline at the foot of the left column, not a card in the
//   right column: the right column is the scorecard's (its live preview is AIV-P2-005, #119);
// - each change has an include checkbox and its own reason field (the ticket), which the artboard's card has not; a
//   change that lowers the evidence starts unticked with a note saying so (AIV-P1-138), which the artboard has not;
// - the quoted excerpt is highlighted only on a proposal that changes something: the highlighter marks the evidence a
//   change cites, and "no change" cites none (AGENTS.md 4, DESIGN.md);
// - "Backed score 55 to 61" carries two basis markers, "Before: Observed" and "After: Projection" (AGENTS.md 1.7);
// - the numbers are the assessment's own preview (the scoring formula), not the artboard's illustrative 55 to 61;
// - Escape does not decline, anywhere in the card: declining discards the proposals for good, so it takes the
//   "Decline" button (the shared card cancels on Escape, which suits a preview that can simply be opened again);
// - "Analysing the summary…", "Waiting for tomorrow's AI allowance…", "The summary could not be analysed…" and
//   "Unusual content in this summary" are the ticket's states; the artboard draws none.

export type MeetingSummaryView = {
  panel: SummaryPanel;
  text: string;
  error: SummaryErrorKey | null;
  busy: boolean;
  included: string[];
  reasons: Record<string, string>;
  preview: SummaryPreview | null;
  reasonMissing: boolean;
  onText: (text: string) => void;
  onAnalyse: () => void;
  onInclude: (competencyId: string, on: boolean) => void;
  onReason: (competencyId: string, reason: string) => void;
  onApply: () => Promise<void>;
  onDecline: () => void;
  onRetryPreview: () => void;
};

export function MeetingSummary({ view }: { view: MeetingSummaryView }) {
  const t = useTranslations();
  const { summary } = view.panel;
  const status = summary?.status;
  const waitingOnWorker = status === 'analysing' || status === 'waiting';
  return (
    <Card>
      <section aria-labelledby="meeting-summary-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="meeting-summary-title" className="font-display text-section text-text">
            {t('interviewSummary.title')}
          </h2>
          <p className="max-w-[72ch] text-body text-text-2">{t('interviewSummary.intro')}</p>
        </div>
        {/* Stays mounted so a change of its text is announced. */}
        <output className="text-body text-text">
          {status === 'analysing' || status === 'waiting' || status === 'failed' || status === 'declined'
            ? t(`interviewSummary.${status}`)
            : ''}
        </output>
        <SuccessBanner>{status === 'applied' ? t('interviewSummary.applied') : undefined}</SuccessBanner>
        {summary?.unusual && status !== 'failed' && (
          <p className="text-meta font-semibold text-text">{t('interviewSummary.unusual')}</p>
        )}
        {view.error && (
          <p role="alert" className="text-body text-err-text">
            {t(`interviewSummary.errors.${view.error}`)}
          </p>
        )}
        {status === 'proposed' && summary ? (
          <Proposals view={view} proposals={summary.proposals} unavailable={summary.previewUnavailable} />
        ) : (
          !waitingOnWorker && <SummaryBox view={view} />
        )}
      </section>
    </Card>
  );
}

function SummaryBox({ view }: { view: MeetingSummaryView }) {
  const t = useTranslations();
  const over = view.text.trim().length > SUMMARY_MAX_CHARS;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="meeting-summary-text">{t('interviewSummary.label')}</Label>
      <Textarea
        id="meeting-summary-text"
        rows={8}
        value={view.text}
        aria-describedby="meeting-summary-count meeting-summary-note"
        aria-invalid={over || undefined}
        onChange={(event) => view.onText(event.target.value)}
      />
      <p id="meeting-summary-count" className="text-meta text-text-2 tabular-nums">
        {t('interviewSummary.count', { count: view.text.trim().length })}
      </p>
      <p id="meeting-summary-note" className="text-meta text-text-2">
        {t('interviewSummary.redacted')}
      </p>
      <div>
        <Button disabled={view.busy} onClick={view.onAnalyse}>
          {t('interviewSummary.analyse')}
        </Button>
      </div>
    </div>
  );
}

function Proposals({
  view,
  proposals,
  unavailable,
}: {
  view: MeetingSummaryView;
  proposals: SummaryProposal[];
  unavailable: boolean;
}) {
  const t = useTranslations();
  const count = view.included.length;
  const { preview } = view;
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- takes no input: it only keeps Escape from the card, where it would decline
    <div
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') event.preventDefault();
      }}
    >
      <PreviewBanner
        title={t('interviewSummary.effect')}
        consequence={t('interviewSummary.logged')}
        confirmLabel={t('interviewSummary.apply', { count })}
        pendingLabel={t('interviewSummary.applying')}
        confirmDisabled={count === 0 || !preview || view.reasonMissing || view.busy}
        cancelLabel={t('interviewSummary.decline')}
        footer={t('interviewSummary.footer')}
        errorMessage={t('interviewSummary.notApplied')}
        onConfirm={view.onApply}
        onCancel={view.onDecline}
      >
        <ul className="flex flex-col gap-4">
          {proposals.map((proposal) => (
            <li key={proposal.competencyId} className="flex flex-col gap-2">
              <Proposal view={view} proposal={proposal} />
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {unavailable ? (
            <>
              <span>{t('interviewSummary.previewUnavailable')}</span>
              <Button size="compact" disabled={view.busy} onClick={view.onRetryPreview}>
                {t('interviewSummary.tryAgain')}
              </Button>
            </>
          ) : preview && count > 0 ? (
            <>
              <span className="font-semibold tabular-nums">
                {t('interviewSummary.backedScore', preview.backedScore)}
              </span>
              <ValueBasis basis="observed" label={t('interviewSummary.before')} />
              <ValueBasis basis="projection" label={t('interviewSummary.after')} />
            </>
          ) : (
            count === 0 && <span className="text-text-2">{t('interviewSummary.nothingIncluded')}</span>
          )}
        </div>
        {view.reasonMissing && <p className="mt-2 text-meta text-text">{t('interviewSummary.reasonNeeded')}</p>}
      </PreviewBanner>
    </div>
  );
}

function Proposal({ view, proposal }: { view: MeetingSummaryView; proposal: SummaryProposal }) {
  const t = useTranslations();
  const { competencyId, name, change, excerpt } = proposal;
  if (!change)
    return (
      <>
        <span>
          {t(proposal.finding === 'not_mentioned' ? 'interviewSummary.notCovered' : 'interviewSummary.noChange', {
            name,
          })}
        </span>
        {excerpt && <q className="text-meta text-text-2">{excerpt}</q>}
      </>
    );
  const strength = (value: typeof change.from) =>
    value ? t(`rubric.strength.${value}`) : t('interviewSummary.noEvidence');
  const included = view.included.includes(competencyId);
  const reasonId = `summary-reason-${competencyId}`;
  const lowersId = `summary-lowers-${competencyId}`;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-semibold">
        {change.from === change.to
          ? t('interviewSummary.stays', { name, strength: strength(change.to) })
          : t('interviewSummary.change', { name, from: strength(change.from), to: strength(change.to) })}
      </span>
      {excerpt && (
        <q className="text-body text-text">
          <EvidenceHighlight
            text={excerpt}
            citations={[{ start: 0, end: excerpt.length, sourceId: competencyId }]}
            markLabel={t('candidateProfile.markLabel')}
          />
        </q>
      )}
      {proposal.alreadyChanged && <span className="text-meta text-text-2">{t('interviewSummary.alreadyChanged')}</span>}
      {proposal.lowers && (
        <span id={lowersId} className="text-meta text-text">
          {t('interviewSummary.lowers')}
        </span>
      )}
      <Checkbox
        label={t('interviewSummary.include')}
        aria-label={`${t('interviewSummary.include')}: ${name}`}
        aria-describedby={proposal.lowers ? lowersId : undefined}
        checked={included}
        disabled={view.busy}
        onChange={(event) => view.onInclude(competencyId, event.target.checked)}
      />
      {included && (
        <>
          <Label htmlFor={reasonId}>{t('interviewSummary.reason', { name })}</Label>
          <Textarea
            id={reasonId}
            rows={2}
            maxLength={1000}
            value={view.reasons[competencyId] ?? ''}
            onChange={(event) => view.onReason(competencyId, event.target.value)}
          />
        </>
      )}
    </div>
  );
}
