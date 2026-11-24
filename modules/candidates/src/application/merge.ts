import type { Tx } from '@credalent/db';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import { likelyReason, type LikelyReason } from '../domain/duplicates.ts';
import { CandidateError, MERGE_REASON_MAX, type Person } from '../domain/person.ts';
import type { CandidateStore } from './people.ts';

/** One merge as stored: who stays, who was folded in, why, and what each module moved (opaque to this module). */
export type MergeRecord = {
  id: string;
  workspaceId: string;
  survivorId: string;
  mergedId: string;
  reason: string;
  automatic: boolean;
  mergedBy: string | null;
  mergedAt: Date;
  undoUntil: Date;
  moved: Record<string, unknown>;
};

/** The merge store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type MergeStore = {
  /** The people, locked for update in id order so two merges over the same people never deadlock. */
  lockPeople(workspaceId: string, personIds: string[]): Promise<Person[]>;
  setMergedInto(workspaceId: string, personId: string, survivorId: string | null): Promise<void>;
  insertMerge(merge: MergeRecord): Promise<void>;
  /** The merge while it is not undone, locked for update; null otherwise. */
  lockActiveMerge(workspaceId: string, mergeId: string): Promise<MergeRecord | null>;
  markUndone(workspaceId: string, mergeId: string, undo: { at: Date; by: string; reason: string }): Promise<void>;
  /** Merges not undone into any of `survivorIds`, oldest first, with the merged person's name. */
  activeMergesInto(workspaceId: string, survivorIds: string[]): Promise<(MergeRecord & { mergedName: string })[]>;
};

/** Another module's records about a person (applications, evidence), moved by a merge and moved back by its undo. */
export type PersonRecords = {
  /** Moves `fromId`'s records to `toId`; returns what moved (stored with the merge, as JSON) and how many. */
  move(
    tx: Tx,
    workspaceId: string,
    fromId: string,
    toId: string,
    mergeId: string,
  ): Promise<{ moved: unknown; count: number }>;
  /** Moves back exactly what `move` returned. */
  restore(tx: Tx, workspaceId: string, fromId: string, toId: string, moved: unknown, mergeId: string): Promise<void>;
};

/** What a merge combines, as the preview lists it. Stages and source channels are intake's (`new`, `linkedin`, ...). */
export type PersonMergeSummary = {
  personId: string;
  displayName: string;
  applications: { jobId: string; stage: string; sources: string[] }[];
  evidenceSources: number;
};
export type MergePreview = { survivor: PersonMergeSummary; merged: PersonMergeSummary };

/** A person's duplicates for the ranking row: possible ones (created earlier, so they would stay) and merges in. */
export type DuplicateReport = {
  personId: string;
  possible: { personId: string; displayName: string; reason: LikelyReason }[];
  merged: { mergeId: string; displayName: string; mergedAt: Date; automatic: boolean; undoable: boolean }[];
};

export type AuditEntry = {
  action: 'candidate.merged' | 'candidate.unmerged';
  subject: { type: 'candidate'; id: string };
  note: string;
  before: Record<string, string | number | boolean | null>;
  after: Record<string, string | number | boolean | null>;
};

export type MergePorts = {
  storeFor(tx: Tx): CandidateStore & MergeStore;
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  applications: PersonRecords & {
    list(tx: Tx, workspaceId: string, personId: string): Promise<PersonMergeSummary['applications']>;
  };
  evidence: PersonRecords & { count(tx: Tx, workspaceId: string, personId: string): Promise<number> };
  /** The workspace's undo window in days (the workspaces `getSettings`' `mergeUndoDays`). */
  undoDays(ctx: WorkspaceContext): Promise<number>;
  /** Appends to the audit log in `ctx.tx`: as the system for an automatic merge, otherwise as the member. */
  audit(ctx: WorkspaceContext, system: boolean, entry: AuditEntry): Promise<void>;
  newId(): string;
  now(): Date;
};

const DAY_MS = 86_400_000;

const validReason = (reason: string) => {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > MERGE_REASON_MAX) throw new CandidateError('merge_reason');
  return trimmed;
};

export function mergeUseCases(ports: MergePorts) {
  const { storeFor, authorize, applications, evidence, audit, newId, now } = ports;

  /**
   * Folds `mergedId` into `survivorId` in `ctx.tx`: their applications and evidence move by the modules' own calls,
   * nothing is deleted, the merge records what moved, and the audit entry is written last. Refused unless both are
   * different, unmerged people of the workspace; an automatic merge of a pair merged meanwhile is skipped (null).
   */
  // shortcut: candidate-accounts' workspace_link still names the merged person, so their portal shows that record; move
  // it with the merge once candidate accounts link to workspaces (AIV-P3-007).
  async function merge(
    ctx: WorkspaceContext,
    survivorId: string,
    mergedId: string,
    { reason, automatic }: { reason: string; automatic: boolean },
  ): Promise<{ mergeId: string } | null> {
    const people = await storeFor(ctx.tx).lockPeople(ctx.workspaceId, [survivorId, mergedId]);
    const survivor = people.find((p) => p.id === survivorId);
    const merged = people.find((p) => p.id === mergedId);
    if (survivorId === mergedId || !survivor || !merged) throw new CandidateError('merge_people');
    if (survivor.mergedIntoId || merged.mergedIntoId) {
      // findPeople reads without a lock, so two arrivals bridging the same pair both get here; the second waited for
      // the first's lock and now sees the pair merged. Its upload must not fail for that.
      if (automatic) return null;
      throw new CandidateError('merge_people');
    }
    const store = storeFor(ctx.tx);
    const id = newId();
    const apps = await applications.move(ctx.tx, ctx.workspaceId, mergedId, survivorId, id);
    const ev = await evidence.move(ctx.tx, ctx.workspaceId, mergedId, survivorId, id);
    await store.setMergedInto(ctx.workspaceId, mergedId, survivorId);
    const mergedAt = now();
    await store.insertMerge({
      id,
      workspaceId: ctx.workspaceId,
      survivorId,
      mergedId,
      reason,
      automatic,
      mergedBy: automatic ? null : ctx.userId,
      mergedAt,
      undoUntil: new Date(mergedAt.getTime() + (await ports.undoDays(ctx)) * DAY_MS),
      moved: { applications: apps.moved, evidence: ev.moved },
    });
    await audit(ctx, automatic, {
      action: 'candidate.merged',
      subject: { type: 'candidate', id: mergedId },
      note: reason,
      before: { mergedIntoId: null },
      after: { mergedIntoId: survivorId, mergeId: id, automatic, applications: apps.count, evidenceSources: ev.count },
    });
    return { mergeId: id };
  }

  async function summary(ctx: WorkspaceContext, person: Person): Promise<PersonMergeSummary> {
    return {
      personId: person.id,
      displayName: person.displayName,
      applications: await applications.list(ctx.tx, ctx.workspaceId, person.id),
      evidenceSources: await evidence.count(ctx.tx, ctx.workspaceId, person.id),
    };
  }

  return {
    merge,

    // shortcut: "not the same person" is not built, so a likely duplicate a recruiter rejects keeps its prompt; store
    // the dismissal per pair when recruiters ask to clear it (AIV-P1-018 follow-up).
    // shortcut: reads every unmerged person of the workspace and compares in memory; store a name key with an index
    // once a workspace holds more than ~5,000 people.
    async detectDuplicates(ctx: WorkspaceContext, personIds: string[]): Promise<DuplicateReport[]> {
      await authorize(ctx, 'candidate.duplicates');
      const store = storeFor(ctx.tx);
      const people = await store.listPeople(ctx.workspaceId);
      const merges = await store.activeMergesInto(ctx.workspaceId, personIds);
      const at = now();
      return personIds.flatMap((personId) => {
        const person = people.find((p) => p.id === personId);
        if (!person) return [];
        // Only people created earlier: they would stay, so the prompt shows once, on the newer record's row.
        const possible = people.flatMap((other) => {
          const earlier =
            other.createdAt < person.createdAt || (+other.createdAt === +person.createdAt && other.id < person.id);
          const reason = other.id !== personId && earlier ? likelyReason(person, other) : null;
          return reason ? [{ personId: other.id, displayName: other.displayName, reason }] : [];
        });
        const merged = merges
          .filter((m) => m.survivorId === personId)
          .map((m) => ({
            mergeId: m.id,
            displayName: m.mergedName,
            mergedAt: m.mergedAt,
            automatic: m.automatic,
            undoable: at < m.undoUntil,
          }));
        return [{ personId, possible, merged }];
      });
    },

    async previewMerge(ctx: WorkspaceContext, survivorId: string, mergedId: string): Promise<MergePreview> {
      await authorize(ctx, 'candidate.duplicates');
      const store = storeFor(ctx.tx);
      const survivor = await store.getPerson(ctx.workspaceId, survivorId);
      const merged = await store.getPerson(ctx.workspaceId, mergedId);
      if (!survivor || !merged || survivorId === mergedId || survivor.mergedIntoId || merged.mergedIntoId)
        throw new CandidateError('merge_people');
      return { survivor: await summary(ctx, survivor), merged: await summary(ctx, merged) };
    },

    async mergePeople(
      ctx: WorkspaceContext,
      survivorId: string,
      mergedId: string,
      reason: string,
    ): Promise<{ mergeId: string }> {
      await authorize(ctx, 'candidate.merge');
      const done = await merge(ctx, survivorId, mergedId, { reason: validReason(reason), automatic: false });
      if (!done) throw new CandidateError('merge_people'); // only an automatic merge is skipped
      return done;
    },

    async unmergePeople(ctx: WorkspaceContext, mergeId: string, reason: string): Promise<void> {
      await authorize(ctx, 'candidate.unmerge');
      const undoReason = validReason(reason);
      const store = storeFor(ctx.tx);
      const record = await store.lockActiveMerge(ctx.workspaceId, mergeId);
      if (!record) throw new CandidateError('merge_not_found');
      if (now() >= record.undoUntil) throw new CandidateError('undo_expired');
      const people = await store.lockPeople(ctx.workspaceId, [record.survivorId, record.mergedId]);
      // A later merge moved the survivor's records on; undo that one first so these move back from where they are.
      if (people.find((p) => p.id === record.survivorId)?.mergedIntoId) throw new CandidateError('undo_blocked');
      const { mergedId, survivorId } = record;
      await evidence.restore(ctx.tx, ctx.workspaceId, mergedId, survivorId, record.moved['evidence'], mergeId);
      await applications.restore(ctx.tx, ctx.workspaceId, mergedId, survivorId, record.moved['applications'], mergeId);
      await store.setMergedInto(ctx.workspaceId, mergedId, null);
      await store.markUndone(ctx.workspaceId, mergeId, { at: now(), by: ctx.userId, reason: undoReason });
      await audit(ctx, false, {
        action: 'candidate.unmerged',
        subject: { type: 'candidate', id: mergedId },
        note: undoReason,
        before: { mergedIntoId: survivorId, mergeId },
        after: { mergedIntoId: null },
      });
    },
  };
}
