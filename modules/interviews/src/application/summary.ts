// A pasted meeting summary to proposed evidence changes a person confirms (AIV-P1-115). Submitting stores the text and
// queues the analysis; the worker stores proposals; reading previews them; only `applySummaryProposals` changes a
// score, through the assessment's own apply command, and only for what a person sent back (AGENTS.md 1.5).
import type { Tx } from '@credalent/db';
import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import { effectiveStatus, InterviewError, type Interview, type InterviewErrorCode } from '../domain/interview.ts';
import type { Rating } from '../domain/scorecard.ts';
import {
  budgetResetAt,
  changedByScorecard,
  ratingOf,
  shownStatus,
  summaryTextSchema,
  toProposals,
  type MeetingSummary,
  type Proposal,
  type ProposalStatus,
  type ProposedStrength,
  type SummaryFinding,
  type SummaryStatus,
} from '../domain/summary.ts';
import type { Ports } from './interviews.ts';

/** The summaries store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type SummaryStore = {
  insert(summary: MeetingSummary): Promise<void>;
  find(workspaceId: string, summaryId: string): Promise<MeetingSummary | null>;
  /** The interview's newest summary. */
  latest(workspaceId: string, interviewId: string): Promise<MeetingSummary | null>;
  /** Moves the status only while it is one of `from`, so two analyses or two decisions cannot both apply. */
  move(
    workspaceId: string,
    summaryId: string,
    from: readonly SummaryStatus[],
    to: SummaryStatus,
    promptVersion?: string,
  ): Promise<boolean>;
  insertProposals(workspaceId: string, summaryId: string, proposals: readonly Proposal[]): Promise<void>;
  proposals(workspaceId: string, summaryId: string): Promise<Proposal[]>;
  /** Marks the summary's proposals: those for `competencyIds`, or all the others when `others`. */
  markProposals(
    workspaceId: string,
    summaryId: string,
    status: ProposalStatus,
    competencyIds: readonly string[],
    others?: boolean,
  ): Promise<void>;
  /** The competencies an applied summary proposal of the interview has changed. */
  appliedCompetencies(workspaceId: string, interviewId: string): Promise<string[]>;
};

type State = { strength: 'strong' | 'medium' | 'supporting' | 'claim' | null; provenLevel: number };

/** What the assessment's `previewScoreChange` returns, as far as this module reads it (no package dependency). */
export type ScorePreview = {
  previewId: string;
  backedScore: { from: number; to: number };
  changes: { competencyId: string; from: State; to: State; replaces: Rating | null }[];
};

type ScoreChange = { assessmentId: string; interviewId: string; changes: { competencyId: string; rating: Rating }[] };

export type SummaryPorts = Pick<
  Ports,
  'storeFor' | 'authorize' | 'jobResource' | 'isSyntheticWorkspace' | 'newId' | 'now'
> & {
  summariesFor(tx: Tx): SummaryStore;
  /** The job's approved rubric version with what each competency means (the jobs module's unauthorised read). */
  rubric(
    tx: Tx,
    workspaceId: string,
    jobId: string,
  ): Promise<{
    id: string;
    competencies: { id: string; name: string; evidenceExpected: string; levelNeeded: number }[];
  } | null>;
  /** Writes `MeetingSummarySubmitted.v1` to the outbox in `tx`, so it commits only with the summary. */
  publishSubmitted(tx: Tx, summary: MeetingSummary): Promise<void>;
  /** Where the text holds content aimed at an AI or a reviewer (`detectUnusualContent` of `@credalent/ai`). */
  unusualSpans(text: string): { start: number; end: number }[];
};

/** The assessment and evidence commands a decision ends in; the app's composition root wires them. */
export type DecisionPorts = {
  latestAssessment(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<{ id: string } | null>;
  previewScoreChange(ctx: WorkspaceContext, input: ScoreChange): Promise<ScorePreview>;
  /** The assessment's `applyScoreChange`: its audit entries are the transaction's last statements (AGENTS.md 3.6). */
  applyScoreChange(
    ctx: WorkspaceContext,
    input: ScoreChange & {
      previewId: string;
      reason: string;
      reasons: Record<string, string>;
      idempotencyKey: string;
      writeUpItemIds: string[];
    },
  ): Promise<unknown>;
  /** The evidence contract's `recordInterviewSummary`. */
  recordSummaryEvidence(
    ctx: WorkspaceContext,
    input: {
      candidateId: string;
      jobId: string;
      writtenAt: Date;
      items: { competencyId: string; excerpt: string; strength: ProposedStrength; level: number }[];
      synthetic: boolean;
    },
  ): Promise<{ itemIds: string[] }>;
};

export type ProposalView = Proposal & {
  /** The competency's strength and proven level before and after; null when the proposal changes nothing or no preview could be made. */
  change: { from: State; to: State } | null;
  /** "Already changed by the scorecard": excluded by default. */
  alreadyChanged: boolean;
};

export type SummaryPreview = {
  /** Send it back to `applySummaryProposals`: it names exactly this result. */
  previewId: string;
  /** The competencies previewed. */
  competencyIds: string[];
  backedScore: { from: number; to: number };
};

export type MeetingSummaryView = {
  summaryId: string;
  status: SummaryStatus;
  unusual: boolean;
  createdAt: Date;
  proposals: ProposalView[];
  /** The proposals included by default, previewed; null with none, or when the assessment cannot be previewed now. */
  preview: SummaryPreview | null;
  /** The proposals wait, but the assessment cannot be previewed now (new evidence still being scored, or none yet). */
  previewUnavailable: boolean;
};

const applyInput = z.strictObject({
  previewId: z.string().min(1),
  changes: z
    .array(z.strictObject({ competencyId: z.uuid(), reason: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(50)
    .refine((cs) => new Set(cs.map((c) => c.competencyId)).size === cs.length, 'One change per competency'),
});
export type ApplySummaryInput = z.input<typeof applyInput>;

// The assessment refuses a preview or an apply with its own error; this module has no dependency on its package.
const refusedByAssessment = (error: unknown) => error instanceof Error && error.name === 'ScoreChangeError';

// shortcut: `to_schedule` counts as held, as the assessment's score change reads it (the pilot does not schedule).
const held = (interview: Interview, now: Date) => !['scheduled', 'cancelled'].includes(effectiveStatus(interview, now));

// SAFETY: only the people on the interview: its interviewer, or an admin or recruiter. A hiring owner who is not the
// interviewer, and any other interviewer, is refused, whatever grant they hold.
const onInterview = (ctx: WorkspaceContext, interview: Interview) =>
  ctx.role === 'admin' || ctx.role === 'recruiter' || interview.interviewerUserId === ctx.userId;

const PENDING: readonly SummaryStatus[] = ['analysing', 'waiting', 'proposed'];

/** The ratings of the proposals for `competencyIds`; `proposal_not_found` for one that proposes no change. */
const ratingsOf = (proposals: readonly Proposal[], competencyIds: readonly string[]) =>
  competencyIds.map((competencyId) => {
    const proposal = proposals.find((p) => p.competencyId === competencyId);
    const rating = proposal && ratingOf(proposal.finding);
    if (!proposal || !rating) throw new InterviewError('proposal_not_found');
    return { competencyId, rating, proposal };
  });

const shown = ({ previewId, backedScore }: ScorePreview, competencyIds: string[]): SummaryPreview => ({
  previewId,
  competencyIds,
  backedScore,
});

export function summaryUseCases(ports: SummaryPorts & DecisionPorts) {
  const { storeFor, summariesFor, authorize, jobResource, now } = ports;

  /** The interview and its job for a member who may act on its summary; throws for anyone else, writing nothing. */
  async function acting(ctx: WorkspaceContext, interviewId: string) {
    const interview = await storeFor(ctx.tx).find(ctx.workspaceId, interviewId);
    if (!interview) throw new InterviewError('interview_not_found');
    if (!onInterview(ctx, interview)) throw new ForbiddenError();
    // The job comes from the stored interview, never the request; one the member cannot reach is refused.
    const job = await jobResource(ctx, interview.jobId);
    if (!job) throw new ForbiddenError();
    await authorize(ctx, 'scorecard.submit', job);
    return interview;
  }

  async function proposed(ctx: WorkspaceContext, summaryId: string) {
    const summary = await summariesFor(ctx.tx).find(ctx.workspaceId, summaryId);
    if (!summary) throw new InterviewError('summary_not_found');
    const interview = await acting(ctx, summary.interviewId);
    if (summary.status !== 'proposed') throw new InterviewError('summary_decided');
    return { summary, interview, proposals: await summariesFor(ctx.tx).proposals(ctx.workspaceId, summaryId) };
  }

  async function preview(
    ctx: WorkspaceContext,
    interview: Interview,
    proposals: readonly Proposal[],
    competencyIds: readonly string[],
  ): Promise<ScorePreview> {
    const latest = await ports.latestAssessment(ctx, interview.candidateId, interview.jobId);
    if (!latest) throw new InterviewError('not_assessed');
    const changes = ratingsOf(proposals, competencyIds).map(({ competencyId, rating }) => ({ competencyId, rating }));
    try {
      return await ports.previewScoreChange(ctx, { assessmentId: latest.id, interviewId: interview.id, changes });
    } catch (error) {
      if (refusedByAssessment(error)) throw new InterviewError('preview_changed');
      throw error;
    }
  }

  return {
    async submitMeetingSummary(
      ctx: WorkspaceContext,
      interviewId: string,
      raw: string,
    ): Promise<{ summaryId: string }> {
      const text = summaryTextSchema.safeParse(raw);
      if (!text.success) throw new InterviewError(text.error.issues[0]?.message as InterviewErrorCode);
      const interview = await acting(ctx, interviewId);
      if (!held(interview, now())) throw new InterviewError('interview_not_held');
      const store = summariesFor(ctx.tx);
      const earlier = await store.latest(ctx.workspaceId, interviewId);
      if (earlier && PENDING.includes(shownStatus(earlier, now()))) throw new InterviewError('summary_pending');
      // A stalled analysis ends here, so its message, should it ever run, finds it no longer analysing and stores nothing.
      // One that landed since it was read has proposals waiting: this summary waits for them too.
      if (earlier?.status === 'analysing' && !(await store.move(ctx.workspaceId, earlier.id, ['analysing'], 'failed')))
        throw new InterviewError('summary_pending');
      const summary: MeetingSummary = {
        id: ports.newId(),
        workspaceId: ctx.workspaceId,
        interviewId,
        authorUserId: ctx.userId,
        text: text.data,
        status: 'analysing',
        unusual: ports.unusualSpans(text.data).length > 0,
        promptVersion: null,
        createdAt: now(),
      };
      await store.insert(summary);
      await ports.publishSubmitted(ctx.tx, summary);
      return { summaryId: summary.id };
    },

    async getMeetingSummary(
      ctx: WorkspaceContext,
      interviewId: string,
    ): Promise<{ summary: MeetingSummaryView | null } | null> {
      const interview = await storeFor(ctx.tx).find(ctx.workspaceId, interviewId);
      if (!interview || !onInterview(ctx, interview)) return null;
      const job = await jobResource(ctx, interview.jobId);
      if (!job) return null;
      await authorize(ctx, 'interview.view', job);
      const store = summariesFor(ctx.tx);
      const summary = await store.latest(ctx.workspaceId, interviewId);
      if (!summary) return { summary: null };
      const proposals = await store.proposals(ctx.workspaceId, summary.id);
      const view: MeetingSummaryView = {
        summaryId: summary.id,
        status: shownStatus(summary, now()),
        unusual: summary.unusual,
        createdAt: summary.createdAt,
        proposals: proposals.map((p) => ({ ...p, change: null, alreadyChanged: false })),
        preview: null,
        previewUnavailable: false,
      };
      const rated = proposals.filter((p) => ratingOf(p.finding)).map((p) => p.competencyId);
      if (summary.status !== 'proposed' || rated.length === 0) return { summary: view };
      try {
        const all = await preview(ctx, interview, proposals, rated);
        const bySummary = new Set(await store.appliedCompetencies(ctx.workspaceId, interviewId));
        view.proposals = proposals.map((p) => {
          const change = all.changes.find((c) => c.competencyId === p.competencyId);
          return {
            ...p,
            change: change ? { from: change.from, to: change.to } : null,
            alreadyChanged: !!change && changedByScorecard(change.replaces, bySummary.has(p.competencyId)),
          };
        });
        const included = view.proposals.filter((p) => p.change && !p.alreadyChanged).map((p) => p.competencyId);
        if (included.length === rated.length) view.preview = shown(all, included);
        else if (included.length) view.preview = shown(await preview(ctx, interview, proposals, included), included);
      } catch (error) {
        if (!(error instanceof InterviewError)) throw error;
        view.previewUnavailable = true;
      }
      return { summary: view };
    },

    async previewSummaryProposals(
      ctx: WorkspaceContext,
      summaryId: string,
      competencyIds: readonly string[],
    ): Promise<SummaryPreview> {
      const ids = z.array(z.uuid()).min(1).max(50).parse(competencyIds);
      const { interview, proposals } = await proposed(ctx, summaryId);
      return shown(await preview(ctx, interview, proposals, ids), ids);
    },

    async applySummaryProposals(ctx: WorkspaceContext, summaryId: string, raw: ApplySummaryInput): Promise<void> {
      const input = applyInput.parse(raw);
      const { summary, interview, proposals } = await proposed(ctx, summaryId);
      const ids = input.changes.map((c) => c.competencyId);
      const rated = ratingsOf(proposals, ids);
      const latest = await ports.latestAssessment(ctx, interview.candidateId, interview.jobId);
      if (!latest) throw new InterviewError('not_assessed');
      const rubric = await ports.rubric(ctx.tx, ctx.workspaceId, interview.jobId);
      const store = summariesFor(ctx.tx);
      // Decided once: a second apply, or a decline racing this one, finds the summary no longer `proposed`.
      if (!(await store.move(ctx.workspaceId, summaryId, ['proposed'], 'applied')))
        throw new InterviewError('summary_decided');
      await store.markProposals(ctx.workspaceId, summaryId, 'applied', ids);
      await store.markProposals(ctx.workspaceId, summaryId, 'declined', ids, true);
      // The summary as the source of each applied change, citing its excerpt (AGENTS.md 1.6).
      const { itemIds } = await ports.recordSummaryEvidence(ctx, {
        candidateId: interview.candidateId,
        jobId: interview.jobId,
        writtenAt: summary.createdAt,
        items: rated.map(({ competencyId, proposal }) => {
          const level = rubric?.competencies.find((c) => c.id === competencyId)?.levelNeeded;
          if (rubric?.id !== interview.rubricVersionId || level === undefined)
            throw new InterviewError('competency_not_in_rubric');
          const strength = proposal.proposedStrength ?? 'claim';
          // The level the job needs, as the interview's own change backs; a weakening shows no level.
          return { competencyId, excerpt: proposal.excerpt ?? '', strength, level: strength === 'medium' ? level : 0 };
        }),
        synthetic: await ports.isSyntheticWorkspace(ctx),
      });
      try {
        // Last: the assessment stores the snapshot and the changes, then one audit entry per change (AGENTS.md 3.6).
        await ports.applyScoreChange(ctx, {
          assessmentId: latest.id,
          interviewId: interview.id,
          changes: rated.map(({ competencyId, rating }) => ({ competencyId, rating })),
          previewId: input.previewId,
          reason: input.changes[0]?.reason ?? '',
          reasons: Object.fromEntries(input.changes.map((c) => [c.competencyId, c.reason])),
          idempotencyKey: summaryId,
          writeUpItemIds: itemIds,
        });
      } catch (error) {
        if (refusedByAssessment(error)) throw new InterviewError('preview_changed');
        throw error;
      }
    },

    async declineSummaryProposals(ctx: WorkspaceContext, summaryId: string): Promise<void> {
      await proposed(ctx, summaryId);
      const store = summariesFor(ctx.tx);
      if (!(await store.move(ctx.workspaceId, summaryId, ['proposed'], 'declined')))
        throw new InterviewError('summary_decided');
      await store.markProposals(ctx.workspaceId, summaryId, 'declined', [], true);
    },
  };
}

/** The model call's answer, checked by `@credalent/ai`: each finding's competency label and its excerpt's span. */
type MapSummaryAnswer = {
  findings: {
    competencyId: string;
    finding: SummaryFinding['finding'];
    reason: string;
    citations: { quote: string; start: number; end: number }[];
  }[];
};

export type AnalysisPorts = Pick<SummaryPorts, 'storeFor' | 'summariesFor' | 'rubric' | 'unusualSpans' | 'now'> & {
  /**
   * `interviews.mapSummary` through `@credalent/ai`, which replaces the identifiers, wraps the summary as an untrusted
   * source, charges the budget and checks every excerpt is the summary's own words. `budget_exceeded` when the
   * workspace's daily budget is spent (no request made); `failed` when the answer was rejected twice or the model is
   * unavailable.
   */
  mapSummary(input: {
    workspaceId: string;
    competencies: { id: string; name: string; meaning: string }[];
    text: string;
    identifiers: { names: string[]; emails: string[]; phones: string[]; others: string[] };
  }): Promise<{ promptVersion: string; answer: MapSummaryAnswer } | 'budget_exceeded' | 'failed'>;
  /** The candidate's name, emails and phones (the candidates module's record), or null when there is no such person. */
  identifiersOf(
    tx: Tx,
    workspaceId: string,
    candidateId: string,
  ): Promise<{ names: string[]; emails: string[]; phones: string[] } | null>;
  /** A member's display name, to remove it from the summary before the model reads it; null when none is known. */
  memberName(userId: string): Promise<string | null>;
  /** The same message again, not before `at` (Service Bus scheduled enqueue). */
  retryAt(workspaceId: string, payload: { summaryId: string; interviewId: string }, at: Date): Promise<void>;
};

/**
 * The worker's job after `MeetingSummarySubmitted.v1`: maps the summary to the competencies its interview tests and
 * stores one proposal each. It proposes only: no score, evidence or audit entry is written here (AGENTS.md 1.5). A
 * summary already analysed, decided or gone is left as it is, so a duplicated message stores one proposal set.
 */
export async function analyseSummary(ports: AnalysisPorts, tx: Tx, workspaceId: string, summaryId: string) {
  const store = ports.summariesFor(tx);
  const summary = await store.find(workspaceId, summaryId);
  if (!summary || (summary.status !== 'analysing' && summary.status !== 'waiting')) return;
  const interview = await ports.storeFor(tx).find(workspaceId, summary.interviewId);
  if (!interview) return;
  const end = (status: SummaryStatus, promptVersion?: string) =>
    store.move(workspaceId, summaryId, ['analysing', 'waiting'], status, promptVersion);
  const rubric = await ports.rubric(tx, workspaceId, interview.jobId);
  const candidate = await ports.identifiersOf(tx, workspaceId, interview.candidateId);
  // shortcut: an interview planned on a rubric version since replaced cannot be analysed, as its scorecard cannot be
  // read (apps/web loadScorecard); read by version when the jobs contract offers it.
  const tested = interview.competencyIds.flatMap((id) => rubric?.competencies.find((c) => c.id === id) ?? []);
  if (!candidate || rubric?.id !== interview.rubricVersionId || tested.length === 0) return void (await end('failed'));
  // Labels, so no opaque id reaches the model.
  const labelled = tested.map((c, i) => ({ id: `C${i + 1}`, name: c.name, meaning: c.evidenceExpected, real: c.id }));
  const others = await Promise.all([interview.interviewerUserId, summary.authorUserId].map(ports.memberName));
  const result = await ports.mapSummary({
    workspaceId,
    competencies: labelled.map(({ real: _id, ...listed }) => listed),
    text: summary.text,
    identifiers: { ...candidate, others: others.filter((name) => name !== null) },
  });
  if (result === 'failed') return void (await end('failed'));
  if (result === 'budget_exceeded') {
    await end('waiting');
    return ports.retryAt(workspaceId, { summaryId, interviewId: interview.id }, budgetResetAt(ports.now()));
  }
  const findings = result.answer.findings.flatMap((f): SummaryFinding[] => {
    const real = labelled.find((c) => c.id === f.competencyId)?.real;
    const [excerpt] = f.citations;
    return real && excerpt ? [{ competencyId: real, finding: f.finding, reason: f.reason, excerpt }] : [];
  });
  const proposals = toProposals(interview.competencyIds, findings, ports.unusualSpans(summary.text));
  // Claimed first: a second analysis in flight finds the summary no longer waiting and stores nothing.
  if (await end('proposed', result.promptVersion)) await store.insertProposals(workspaceId, summaryId, proposals);
}
