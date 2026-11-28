'use client';

import { useTranslations } from '@credalent/i18n/react';
import {
  MARKS,
  NOTE_MAX,
  notAssessed,
  RATINGS,
  RECOMMENDATIONS,
  type Mark,
  type Rating,
  type Recommendation,
  type ScorecardDraft,
} from '@credalent/interviews';
import {
  Button,
  Card,
  EvidenceHighlight,
  Label,
  RadioGroup,
  SegmentedControl,
  SuccessBanner,
  Textarea,
  ValueBasis,
} from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LimitLine, Standing } from '@/features/evidence-profile';
import type { ScorecardCompetency, ScorecardData, SubmitOutcome } from '../domain/scorecard.ts';

// AIV-P2-004: the Interview artboard (docs/01-design/artboards/Interview.dc.html): breadcrumb, title, subtitle and "Save
// and close"; the rounds; one card per competency to investigate with its evidence, questions, rating and note; and
// "Your recommendation" with "Submit scorecard".
// Deviations, each for the ticket, a rule, the data or a later ticket:
// - the rating is a radio group drawn as segments (the shared SegmentedControl), not four toggle buttons: the ticket's
//   Gherkin asks for a labelled radio group, and its legend names the competency for a screen reader;
// - "Not asked" and "Not answered" under each question, "Not assessed in this round · stays a gap" and the disabled
//   rating are the ticket's, not the artboard's. A pressed mark is ink with a tick, never colour alone;
// - a competency with no suggested question says so, links to the evidence profile where questions are suggested, and
//   offers the two marks for "Your own questions on this competency", so it can be recorded as not tested;
// - the questions are the stored suggested ones (AIV-P1-113, owner decision 24 Nov 2026), each with "A strong answer
//   shows" and "A weak answer shows"; the interview guide and its live task are AIV-P2-003 (#117), so no live task is
//   drawn. This page asks for no questions itself: it makes no AI call;
// - the evidence is each cited item's own words on a line, not a sentence written around them, with an item's own
//   strength and tag when weaker than the row's, the sources and the "Limit:" lines, as on the evidence profile
//   (AIV-P1-045): the evidence contract holds the exact words and nothing writes prose about them;
// - only an item behind the proven level is highlighted. The artboard and the ticket's Gherkin highlight the CV line
//   "raised answer accuracy from 71% to 88%", a claim; here a claim's words are shown plain, whatever its strength
//   (AGENTS.md 1.6, the merged rule of AIV-P1-045 and AIV-P1-113);
// - a source backed by an uploaded file is a link for admins and recruiters only; an interviewer or hiring owner reads
//   its name (AGENTS.md 1.9);
// - "Effect on the assessment" is a slot (`effect`) at the top of the right column: the live preview (AIV-P2-005) has
//   its own controller and component, `ScoreEffect`;
// - the evidence states its limit once and a claim reads "Claim only" in neutral ink, as on the profile; the rounds
//   read "Round 1", "Round 2" and "Round 3", the subtitle no longer says "structured screen", and the notes placeholder
//   is "What the candidate said or did", where the artboard draws "Evidence, not impressions" (AIV-P1-165 §11, §12);
// - "Submit scorecard" (AIV-P2-006) first checks that at least one competency is rated or marked as not tested (rate
//   only what was tested, AIV-P1-165 §12) and that each rating but "Not shown" has a note (kept with it, logged with any
//   change it makes, and the words its evidence cites), saying which is not, and is
//   disabled while the preview of the current ratings is on its way, so what is applied is what the person saw. Under
//   "Scorecard submitted and logged" its name is the candidate's full name, not the first name. While the preview of
//   the ratings is on its way or unavailable a line under the button says why it waits (no preview, no submit,
//   AGENTS.md 1.5); a submitted scorecard keeps it disabled;
// - a line under "Submit scorecard" says what submitting does and that the recommendation changes no stage, which
//   the artboard leaves to the panel above (AGENTS.md 1.5: nothing applies unseen);
// - the confirmation is the shared SuccessBanner (ok tone, tick and words, a status region) with "See the ranking"
//   inline, as the artboard's `note note-ok`; the other outcomes ("Not submitted…", "Already submitted") are plain
//   text in a status region. The ticket's "Your ratings are saved; try again." reads "Your ratings are saved. Try
//   again.": the catalogue has no semicolons;
// - a note is at most 1,000 characters, with its count under it: the assessment logs it as the change's reason, which
//   takes no more;
// - no "Audit trail" card: the submit's entries are the audit log's (`score.changed`, one per rating), and reading them
//   back onto this page and the evidence profile ("Interview history and score changes") is AIV-P1-046 (#110);
// - the draft saves itself a moment after each change, with "Saving your draft…" and "Draft saved…" beside "Save and
//   close" (the ticket), which is a button that saves and then opens Interviews, not a plain link;
// - a member who is not the interviewer or an admin, and anyone once the interview is completed or cancelled, reads the
//   page with every control disabled and a line saying why: the artboard draws only the interviewer's view;
// - "Evidence assessed" carries its basis marker, "Observed" or "Not yet available" (AGENTS.md 1.7), and a round before
//   the current one reads "Earlier round": the artboard draws Round 1 only;
// - the time reads "Today, 14:00" or "18 Nov, 14:00", the catalogue's one format (`interviews.when`), not "today, 14:00";
// - the recommendations name the round after this one ("Round 2 shortlist" on Round 1), or "the next stage";
// - `children` is a slot for a sibling panel on this page (the meeting summary, AIV-P1-115), at the foot of the left column;
//   while that panel's preview card is open (`quietSubmit`), "Submit scorecard" is a default button, so the card's
//   "Apply" is the view's one primary button (DESIGN.md);
// - the subtitle is the 14/20 px body size, not 15/22 px, and the card padding is the shared Card's 16 px, not 20 px:
//   the tokens and @credalent/ui have neither;
// - no Credalent assistant panel or "Ask Credalent": AIV-P2-028 (#142); the sidebar, search and top bar are the shell's.

export type ScorecardHandlers = {
  draft: ScorecardDraft;
  saving: 'idle' | 'saving' | 'saved' | 'failed';
  /** "Submit scorecard" was chosen with nothing rated or marked as not tested. */
  blocked: boolean;
  noNote: string[];
  outcome: SubmitOutcome | 'submitting' | null;
  /** Why submitting waits: the preview of the ratings now is on its way, or unavailable; null when it is ready. */
  previewBlock: 'pending' | 'unavailable' | null;
  onRate: (competencyId: string, rating: Rating) => void;
  onNote: (competencyId: string, note: string) => void;
  onMark: (competencyId: string, index: number, mark: Mark) => void;
  onRecommend: (recommendation: Recommendation) => void;
  onSaveAndClose: () => void;
  onSubmit: () => void;
};

export type ScorecardView =
  | { status: 'loading' }
  | { status: 'error'; onRetry: () => void }
  | ({ status: 'ready' } & ScorecardData & ScorecardHandlers);

const svg = (path: ReactNode, strokeWidth = 2) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-3.5 flex-none"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);
const tick = svg(<path d="m5 12.5 4.5 4.5L19 7.5" />, 2.6);
const linkIcon = svg(
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
);

const INTERVIEWS = '/app/interviews' as Route;
/** The outcomes after which the scorecard is submitted. */
const DONE: readonly (SubmitOutcome | 'submitting')[] = ['updated', 'unchanged', 'already'];
const ROUNDS = ['structured_screen', 'evidence_defence', 'panel'] as const;

export function Scorecard({
  view,
  children,
  effect,
  quietSubmit = false,
}: {
  view: ScorecardView;
  children?: ReactNode;
  /** "Effect on the assessment" (AIV-P2-005), above "Your recommendation". */
  effect?: ReactNode;
  /** A preview card with its own primary button is open beside the form. */
  quietSubmit?: boolean;
}) {
  const t = useTranslations();
  if (view.status !== 'ready')
    return (
      <>
        <h1 className="mb-6 font-display text-title tracking-tight">{t('scorecard.pageTitle')}</h1>
        {view.status === 'loading' ? (
          <Card loading loadingLabel={t('scorecard.loading')} />
        ) : (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-body text-text">
            {t('scorecard.error')}
            <Button size="compact" onClick={view.onRetry}>
              {t('access.retry')}
            </Button>
          </div>
        )}
      </>
    );
  const name = view.candidate ?? t('interviews.unnamed');
  // Just submitted here (announced); `view.submitted` alone is a scorecard reopened after its submit.
  const done = view.outcome !== null && DONE.includes(view.outcome);
  const submitted = view.submitted || done;
  const ranking = (
    // rankingHref builds the path from an opaque id, which typed routes cannot check.
    <Link href={view.rankingHref as Route} className="underline underline-offset-2">
      {t('scorecard.seeRanking')}
    </Link>
  );
  const at = view.scheduledAt && new Date(view.scheduledAt);
  const subtitle = [
    view.job,
    at ? t(view.today ? 'interviews.when.today' : 'interviews.when.at', { at }) : t('interviews.when.none'),
    view.interviewer === null ? t('scorecard.interviewerYou') : t('scorecard.interviewer', { name: view.interviewer }),
  ].join(' · ');
  return (
    <div className="flex flex-col gap-6 self-stretch">
      <div className="flex flex-col gap-2.5">
        <nav aria-label={t('jobHeader.breadcrumb')} className="flex flex-wrap gap-1.5 text-meta text-text-2">
          <Link href={INTERVIEWS} className="underline underline-offset-2 hover:text-text">
            {t('shell.nav.interviews')}
          </Link>
          <span aria-hidden="true">{'/'}</span>
          <span aria-current="page">{t(`scorecard.crumb.${view.round}`, { name })}</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-display text-title tracking-tight">{t(`scorecard.title.${view.round}`, { name })}</h1>
            <p className="max-w-[72ch] text-body text-text-2">{subtitle}</p>
          </div>
          {view.canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Stays mounted so the change of its text is announced. */}
              <output className="text-meta text-text-2">
                {view.saving === 'idle' ? '' : t(`scorecard.${view.saving}`)}
              </output>
              <Button disabled={view.saving === 'saving'} onClick={view.onSaveAndClose}>
                {t('scorecard.saveAndClose')}
              </Button>
            </div>
          )}
        </div>
        {!view.canEdit && (
          <p className="text-body text-text">
            {t(view.submitted ? 'scorecard.submittedReadOnly' : 'scorecard.readOnly')}
          </p>
        )}
      </div>
      <Rounds view={view} />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[8_1_600px] flex-col gap-6">
          {view.competencies.map((competency) => (
            <Competency key={competency.competencyId} competency={competency} view={view} />
          ))}
          {children}
        </div>
        <div className="flex min-w-0 flex-[4_1_320px] flex-col gap-6">
          {effect}
          <Card>
            <section aria-labelledby="recommendation-title" className="flex flex-col gap-3">
              <h2 id="recommendation-title" className="font-display text-section text-text">
                {t('scorecard.recommendation')}
              </h2>
              <RadioGroup
                legend={t('scorecard.recommendationGroup')}
                options={RECOMMENDATIONS.map((value) => ({
                  value,
                  label: t(`scorecard.recommendations.${value}`, { round: view.round }),
                }))}
                value={view.draft.recommendation ?? ''}
                onValueChange={(value) => view.onRecommend(value as Recommendation)}
                disabled={!view.canEdit}
              />
              <p className="text-meta text-text-2">{t('scorecard.notADecision')}</p>
              {view.canEdit && (
                <>
                  <div>
                    <Button
                      variant={quietSubmit ? 'secondary' : 'primary'}
                      disabled={
                        view.saving === 'saving' ||
                        view.outcome === 'submitting' ||
                        submitted ||
                        view.previewBlock !== null
                      }
                      {...(view.previewBlock && { 'aria-describedby': 'submit-waits' })}
                      onClick={view.onSubmit}
                    >
                      {t('scorecard.submit')}
                    </Button>
                  </div>
                  {view.blocked && (
                    <p role="alert" className="text-body font-medium text-text">
                      {t('scorecard.rateOrMark')}
                    </p>
                  )}
                  {view.previewBlock && (
                    <p id="submit-waits" className="text-meta text-text">
                      {t(`scorecard.waits.${view.previewBlock}`)}
                    </p>
                  )}
                  <p className="text-meta text-text-2">{t('scorecard.submitHelp')}</p>
                </>
              )}
              {/* Both stay mounted, outside the editable state the submit ends, so a result is announced. */}
              <output className="text-body font-medium text-text">
                {view.outcome && !done && t(`scorecard.outcome.${view.outcome}`, { name })}
              </output>
              <SuccessBanner>
                {done && view.outcome && (
                  <>
                    {t(`scorecard.outcome.${view.outcome}`, { name })} {ranking}
                  </>
                )}
              </SuccessBanner>
              {view.submitted && !done && <div className="text-body">{ranking}</div>}
            </section>
          </Card>
        </div>
      </div>
    </div>
  );
}

type Ready = Extract<ScorecardView, { status: 'ready' }>;

function Rounds({ view }: { view: Ready }) {
  const t = useTranslations();
  const step = 'flex flex-[1_1_200px] items-center gap-2.5 rounded-control border px-3.5 py-2.5';
  const dot = 'grid size-6 flex-none place-items-center rounded-full';
  const current = ROUNDS.indexOf(view.round);
  return (
    <ol aria-label={t('scorecard.rounds')} className="flex flex-wrap gap-3">
      <li className={`${step} border-border bg-surface`}>
        <span className={`${dot} ${view.assessed ? 'bg-action text-on-action' : 'border border-border-strong'}`}>
          {view.assessed && tick}
        </span>
        <span className="flex flex-col">
          <span className="font-semibold text-text">{t('scorecard.assessed')}</span>
          <span className="flex flex-wrap items-center gap-2 text-meta text-text-2">
            {view.assessed
              ? t('scorecard.assessedOn', { at: new Date(view.assessed.at), score: view.assessed.backedScore })
              : t('scorecard.notAssessedYet')}
            {view.assessed ? (
              <ValueBasis basis="observed" label={t('ranking.observed')} />
            ) : (
              <ValueBasis basis="not-available" label={t('ranking.notYetAvailable')} />
            )}
          </span>
        </span>
      </li>
      {ROUNDS.map((round, i) => (
        <li
          key={round}
          aria-current={i === current ? 'step' : undefined}
          className={`${step} ${i === current ? 'border-action bg-surface-subtle' : 'border-border bg-surface'}`}
        >
          <span className={`${dot} border border-border-strong`} />
          <span className="flex flex-col">
            <span className="font-semibold text-text">{t(`interviews.round.${round}`)}</span>
            <span className="text-meta text-text-2">
              {t(i === current ? 'scorecard.current' : i < current ? 'scorecard.earlier' : 'scorecard.later')}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Competency({ competency, view }: { competency: ScorecardCompetency; view: Ready }) {
  const t = useTranslations();
  const { competencyId: id, name, evidence } = competency;
  const draft = view.draft.competencies.find((c) => c.competencyId === id);
  if (!draft) return null;
  const untested = notAssessed(draft);
  const noNote = view.noNote.includes(id);
  return (
    <Card>
      <section aria-labelledby={`competency-${id}`} className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 id={`competency-${id}`} className="flex-[1_1_220px] font-display text-section text-text">
            {name}{' '}
            <span className="font-sans text-meta font-normal text-text-2 tabular-nums">
              {t('candidateProfile.weight', { weight: competency.weightPercent })}
            </span>
          </h2>
          {evidence?.lead && <Standing {...evidence.lead} />}
        </div>
        {!evidence || evidence.items.length === 0 ? (
          <p className="text-body text-text-2">{t('candidateProfile.noEvidence')}</p>
        ) : (
          <ul className="flex max-w-[72ch] flex-col gap-1.5 text-body text-text">
            {evidence.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* SAFETY: the highlighter marks only what the proven level rests on; a claim stays plain (AGENTS.md 1.6). */}
                <span>
                  {item.highlighted ? (
                    <EvidenceHighlight
                      text={item.excerpt}
                      citations={[{ start: 0, end: item.excerpt.length, sourceId: item.id }]}
                      markLabel={t('candidateProfile.markLabel')}
                    />
                  ) : (
                    item.excerpt
                  )}
                </span>
                {/* SAFETY: an item weaker than the row's lead says so itself; it never reads under the lead's tag. */}
                {item.own && <Standing {...item.own} under={evidence.lead} />}
              </li>
            ))}
          </ul>
        )}
        {evidence && <LimitLine card={evidence} />}
        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-semibold text-text">{t('scorecard.questions')}</span>
          {competency.questions.length === 0 && (
            <p className="text-meta text-text-2">
              {t('scorecard.noQuestions')}{' '}
              {/* profileHref builds the path from opaque ids, which typed routes cannot check. */}
              <Link href={view.profileHref as Route} className="underline underline-offset-2 hover:text-text">
                {t('scorecard.suggestOnProfile')}
              </Link>
            </p>
          )}
          <ol
            className={`flex max-w-[72ch] flex-col gap-3 text-body text-text ${competency.questions.length > 0 ? 'list-decimal ps-4.5' : ''}`}
          >
            {draft.questions.map((question, i) => {
              const suggested = competency.questions[i];
              return (
                // The model may repeat a question, and questions are never reordered.
                <li key={`${i}:${question.text}`} className="flex flex-col gap-1">
                  <span>{question.text || t('scorecard.ownQuestions')}</span>
                  {suggested && (
                    <>
                      <span className="text-meta text-text-2">
                        <strong className="font-semibold text-text">{t('suggestedQuestions.strong')}</strong>{' '}
                        {suggested.strongAnswer}
                      </span>
                      <span className="text-meta text-text-2">
                        <strong className="font-semibold text-text">{t('suggestedQuestions.weak')}</strong>{' '}
                        {suggested.weakAnswer}
                      </span>
                    </>
                  )}
                  <fieldset className="flex min-w-0 flex-wrap gap-2 pt-0.5">
                    <legend className="sr-only">
                      {question.text ? t('scorecard.question', { number: i + 1 }) : t('scorecard.ownQuestions')}
                    </legend>
                    {MARKS.map((mark) => (
                      <Button
                        key={mark}
                        size="compact"
                        // Ink and a tick mark the pressed one: selection, not a second primary action.
                        variant={question.mark === mark ? 'primary' : 'secondary'}
                        aria-pressed={question.mark === mark}
                        disabled={!view.canEdit}
                        onClick={() => view.onMark(id, i, mark)}
                      >
                        {question.mark === mark && tick}
                        {t(`scorecard.marks.${mark}`)}
                      </Button>
                    ))}
                  </fieldset>
                </li>
              );
            })}
          </ol>
        </div>
        {evidence && evidence.sources.length > 0 && (
          <ul
            aria-label={t('candidateProfile.sources')}
            className="flex flex-wrap gap-x-4.5 gap-y-1.5 font-mono text-meta text-text-2"
          >
            {evidence.sources.map((chip) => (
              <li key={chip.key} className="inline-flex items-center gap-1.5">
                {linkIcon}
                <span>
                  {chip.kind === 'check' ? (
                    t('candidateProfile.checked', { method: chip.method, at: chip.at })
                  ) : chip.kind === 'text' ? (
                    chip.text
                  ) : (
                    <a
                      // A file opens through the route that issues its 5-minute link and audits the access; the id is opaque.
                      href={chip.kind === 'link' ? chip.url : `/api/files/${chip.fileId}/link`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-text"
                    >
                      {chip.text}
                      <span className="sr-only"> {t('candidateProfile.newTab')}</span>
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="-mx-4 flex flex-col gap-2 border-t border-border px-4 pt-3.5">
          <SegmentedControl
            legend={
              <>
                {t('scorecard.assessment')}
                <span className="sr-only">{`: ${name}`}</span>
              </>
            }
            options={RATINGS.map((value) => ({ value, label: t(`scorecard.ratings.${value}`) }))}
            // SAFETY: a competency that was not tested shows no rating and takes none (AGENTS.md 1.6).
            value={untested ? '' : (draft.rating ?? '')}
            onValueChange={(value) => view.onRate(id, value as Rating)}
            disabled={untested || !view.canEdit}
            {...(untested && { 'aria-describedby': `untested-${id}` })}
          />
          {untested && (
            <p id={`untested-${id}`} className="text-body font-medium text-text">
              {t('scorecard.notAssessed')}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${id}`}>{t('scorecard.note')}</Label>
            <Textarea
              id={`note-${id}`}
              aria-invalid={noNote}
              aria-describedby={noNote ? `no-note-${id} note-count-${id}` : `note-count-${id}`}
              rows={2}
              maxLength={NOTE_MAX}
              className="resize-y"
              placeholder={t('scorecard.notePlaceholder')}
              value={draft.note}
              disabled={!view.canEdit}
              onChange={(event) => view.onNote(id, event.target.value)}
            />
            <p id={`note-count-${id}`} className="text-meta text-text-2 tabular-nums">
              {t('scorecard.noteCount', { count: draft.note.length, max: NOTE_MAX })}
            </p>
            {noNote && (
              <p id={`no-note-${id}`} role="alert" className="text-body font-medium text-text">
                {t('scorecard.addNote')}
              </p>
            )}
          </div>
        </div>
      </section>
    </Card>
  );
}
