import {
  AiUnavailable,
  BudgetExceeded,
  detectUnusualContent,
  InvalidCitation,
  SchemaMismatch,
  SourceTooLong,
  UncitedOutput,
} from '@credalent/ai';
import type { Tx } from '@credalent/db';
import { log } from '@credalent/observability';
import type { WorkspaceContext } from '@credalent/workspaces';
import {
  CV_LABEL,
  cvClaims,
  hiddenText,
  looksLike,
  nameFromCv,
  mergeNotes,
  pageSpan,
  repositoryLinks,
  type CvExtraction,
  type CvLayout,
  type CvParseStatus,
  type SourceNote,
} from '../domain/cv.ts';
import type { EvidenceItem, EvidenceSource } from '../domain/evidence.ts';
import type { Ports } from './evidence.ts';
import type { RequestRepositoryReadInput } from './repositoryRead.ts';

/** Document Intelligence says the file is not a document it can read (a corrupt or unsupported file). */
export class DocumentUnreadable extends Error {
  override name = 'DocumentUnreadable';
  constructor() {
    super('Document Intelligence could not read the file');
  }
}

/** Document Intelligence timed out, was throttled or failed (5xx); worth another attempt. */
export class DocumentIntelligenceUnavailable extends Error {
  override name = 'DocumentIntelligenceUnavailable';
  constructor(reason: string) {
    super(`Document Intelligence unavailable: ${reason}`);
  }
}

/** Azure AI Document Intelligence's layout model; the adapter zod-checks every answer. */
export type DocumentIntelligencePort = {
  /** Throws DocumentUnreadable or DocumentIntelligenceUnavailable. */
  analyze(data: Buffer, contentType: string): Promise<CvLayout>;
};

export type CvParse = { workspaceId: string; sourceId: string; candidateId: string; status: CvParseStatus };

/** Over one workspace-scoped transaction; every method filters by `workspaceId`. */
export type CvParseStore = {
  /**
   * Inserts the `cv` source and its pending parse, unless the candidate already has a `cv` source for the file (a
   * concurrent one included): then neither is kept and that source's id is returned.
   */
  insertOrGet(source: EvidenceSource): Promise<string | null>;
  find(workspaceId: string, sourceId: string): Promise<{ parse: CvParse; source: EvidenceSource } | null>;
  /** The parses of a CV file still to run (pending, or failed and waiting for a redelivery; not `waiting`, which its schedule runs), by source id. */
  pendingForFile(workspaceId: string, fileId: string): Promise<string[]>;
  /** Sets the status only while pending, waiting or failed; false when another delivery finished it first. */
  finish(workspaceId: string, sourceId: string, status: Exclude<CvParseStatus, 'pending'>): Promise<boolean>;
  insertItems(items: EvidenceItem[], notes: SourceNote[]): Promise<void>;
  notes(workspaceId: string, sourceId: string): Promise<SourceNote[]>;
};

export type CvPorts = Pick<Ports, 'authorize' | 'newId' | 'now'> & {
  cvStoreFor(tx: Tx): CvParseStore;
  /** Writes `CvParseRequested.v1` to the outbox in `tx`. */
  publishParseRequested(tx: Tx, source: EvidenceSource): Promise<void>;
};

export type RequestCvParseInput = {
  candidateId: string;
  /** The files module's id of the uploaded CV (purpose `cv`); parsed once it is clean. */
  fileId: string;
  synthetic: boolean;
};

export type CvParseView = {
  status: CvParseStatus;
  /** "Unusual content in this source" notes, CV order; they change no score, strength, provenance or stage. */
  notes: Pick<SourceNote, 'reason' | 'excerpt' | 'excerptSpan'>[];
};

/**
 * Stores a pending `cv` source for the file and queues its parse (`CvParseRequested.v1`), once per candidate and file:
 * a second request returns the first source's id and queues nothing. No authorisation here: `requestCvParse` authorises
 * a person; the `ApplicationReceived.v1` handler runs as the system in its envelope's workspace and passes only the
 * arrival's own CV files for the arrival's own person (AIV-P1-079).
 */
export async function queueCvParse(
  ports: Pick<CvPorts, 'cvStoreFor' | 'publishParseRequested' | 'newId' | 'now'>,
  tx: Tx,
  workspaceId: string,
  input: RequestCvParseInput,
): Promise<{ sourceId: string; queued: boolean }> {
  const at = ports.now();
  const source: EvidenceSource = {
    id: ports.newId(),
    workspaceId,
    candidateId: input.candidateId,
    kind: 'cv',
    label: CV_LABEL,
    url: null,
    blobFileId: input.fileId,
    capturedAt: at,
    checkedAt: null,
    checkMethod: null,
    synthetic: input.synthetic,
    createdAt: at,
    textFingerprint: null,
  };
  const existing = await ports.cvStoreFor(tx).insertOrGet(source);
  if (existing) return { sourceId: existing, queued: false };
  await ports.publishParseRequested(tx, source);
  return { sourceId: source.id, queued: true };
}

export function cvParseUseCases(ports: CvPorts) {
  const { cvStoreFor, authorize } = ports;
  return {
    /** Stores a pending `cv` source for the file and asks the worker to parse it (`evidence.cv.parse`). */
    // shortcut: a member's call is not checked to pass the candidate's own file (files carry no owner link); the
    // arrival handler scopes its files itself (AIV-P1-079), and a screen that calls this must pass only the candidate's
    // own CV file ids.
    async requestCvParse(ctx: WorkspaceContext, input: RequestCvParseInput): Promise<{ sourceId: string }> {
      await authorize(ctx, 'candidate.create');
      const { sourceId } = await queueCvParse(ports, ctx.tx, ctx.workspaceId, input);
      return { sourceId };
    },

    async getCvParse(ctx: WorkspaceContext, sourceId: string): Promise<CvParseView | null> {
      await authorize(ctx, 'candidate.view');
      const store = cvStoreFor(ctx.tx);
      const found = await store.find(ctx.workspaceId, sourceId);
      if (!found) return null;
      const notes = await store.notes(ctx.workspaceId, sourceId);
      return {
        status: found.parse.status,
        notes: notes.map(({ reason, excerpt, excerptSpan }) => ({ reason, excerpt, excerptSpan })),
      };
    },
  };
}

export type ParsePorts = Pick<CvPorts, 'cvStoreFor' | 'newId' | 'now'> &
  Pick<Ports, 'publishRecorded'> & {
    /**
     * A clean file's purpose, type and bytes (the files module, in `tx`); `pending` while it waits for its scan,
     * `rejected` when it never will be clean.
     */
    readCleanFile(
      tx: Tx,
      workspaceId: string,
      fileId: string,
    ): Promise<{ purpose: string; contentType: string; data: Buffer } | 'pending' | 'rejected'>;
    documentIntelligence: DocumentIntelligencePort;
    /**
     * `parseCvRequest` of @credalent/ai on the CV text as the one `cv` source, checked by the citation contract, with
     * the candidate's identifiers read in `tx` (AIV-P1-080).
     */
    extract(
      tx: Tx,
      workspaceId: string,
      candidateId: string,
      sourceId: string,
      text: string,
      /** The name read from the CV when the applicant is still unnamed: redacted along with the record's own. */
      names: string[],
    ): Promise<CvExtraction>;
    /** Whether the candidate still carries the intake placeholder name (the candidates module, in `tx`). */
    readPerson(tx: Tx, workspaceId: string, candidateId: string): Promise<{ unnamed: boolean } | null>;
    /** Names an unnamed applicant from the CV and audits it, as the system, in `tx`; never overwrites a name. */
    nameApplicant(tx: Tx, workspaceId: string, candidateId: string, name: string): Promise<void>;
    /** `queueRepositoryRead` (AIV-P1-076): one pending read per candidate and link, as the system, in `tx`. */
    queueRead(tx: Tx, workspaceId: string, input: RequestRepositoryReadInput): Promise<unknown>;
    /** Adds the CV's emails and phones to the candidate record (the candidates module, in `tx`). */
    recordContact(
      tx: Tx,
      workspaceId: string,
      candidateId: string,
      contact: { emails: string[]; phones: string[] },
    ): Promise<void>;
  };

/** Answers a redelivery cannot change: the source shows "Could not be read automatically" and the message completes. */
// A CV over the source cap (AIV-P2-062) is one: never truncated, it is not read automatically.
const PERMANENT_AI_FAILURES = [SchemaMismatch, UncitedOutput, InvalidCitation, SourceTooLong];

/**
 * A failure worth another delivery (a timeout, throttling, an outage): the worker records "Parsing failed, retry" in its
 * own transaction and rethrows, so the consumer backs off, redelivers and dead-letters after its last delivery.
 */
export const isTransient = (error: unknown) =>
  error instanceof DocumentIntelligenceUnavailable || error instanceof AiUnavailable;

/**
 * The worker job `evidence.cv.parse`: reads the clean CV, extracts its text and layout with Document Intelligence,
 * asks the model for its statements under the citation contract, and stores every statement as a claim with the CV's
 * "Unusual content in this source" notes, all in `tx`. A file still in quarantine leaves the parse pending (FileClean.v1
 * runs it again). A `failed` parse runs again on a redelivery, and a `waiting` one when its scheduled time comes. Throws the transient errors (`isTransient`). Returns the
 * status and the number of notes, or null when there was nothing to do.
 */
// shortcut: Document Intelligence and the model run inside the consumer's workspace transaction and message lock, as the
// repository read does; fetch before opening the write transaction if pilot parses hold a connection too long. A
// transient failure on one of several parses a FileClean.v1 runs rolls back the others too; they re-run on redelivery.
export async function parseCv(
  ports: ParsePorts,
  tx: Tx,
  workspaceId: string,
  sourceId: string,
): Promise<{ status: CvParseStatus; notes: number } | null> {
  const {
    cvStoreFor,
    publishRecorded,
    readCleanFile,
    documentIntelligence,
    extract,
    readPerson,
    nameApplicant,
    recordContact,
    queueRead,
    newId,
    now,
  } = ports;
  const store = cvStoreFor(tx);
  const found = await store.find(workspaceId, sourceId);
  const open = ['pending', 'waiting', 'failed'].includes(found?.parse.status ?? '');
  if (!found || !open || !found.source.blobFileId) return null;
  const { source } = found;
  const file = await readCleanFile(tx, workspaceId, found.source.blobFileId);
  if (file === 'pending') return null;
  const end = async (status: Exclude<CvParseStatus, 'pending'>) =>
    (await store.finish(workspaceId, sourceId, status)) ? { status, notes: 0 } : null;
  // A file rejected before the parse was asked for never sends another event, so the parse ends here.
  if (file === 'rejected') return end('unreadable');

  if (file.purpose !== 'cv' || !looksLike(file.contentType, file.data)) return end('unreadable');
  let layout: CvLayout;
  try {
    layout = await documentIntelligence.analyze(file.data, file.contentType);
  } catch (error) {
    if (error instanceof DocumentUnreadable) return end('unreadable');
    throw error;
  }
  if (!layout.content.trim()) return end('unreadable');

  const instructions = detectUnusualContent(layout.content);
  const applicant = await readPerson(tx, workspaceId, source.candidateId);
  if (!applicant) throw new Error('applicant not found for the CV parse');
  // The placeholder redacts nothing, so an unnamed applicant's CV goes to the model only once its name is known (AIV-P1-090).
  // The CV's name is redacted whether or not the record already has one (a typed "Sara O." must not leak "Okoye").
  const name = nameFromCv(layout.content);
  if (applicant.unnamed && !name) {
    log.info({ 'evidence.source_id': sourceId, reason: 'name_not_found' }, 'cv parse ended: no name in the CV');
    return end('unreadable');
  }
  let extraction: CvExtraction;
  try {
    extraction = await extract(tx, workspaceId, source.candidateId, sourceId, layout.content, name ? [name] : []);
  } catch (error) {
    // The daily budget is spent: the handler schedules the parse for the next UTC day (AIV-P1-089).
    if (error instanceof BudgetExceeded) return end('waiting');
    if (PERMANENT_AI_FAILURES.some((kind) => error instanceof kind)) return end('unreadable');
    throw error;
  }
  const { claims, contact } = cvClaims(extraction, layout, instructions);
  if (!(await store.finish(workspaceId, sourceId, 'parsed'))) return null;

  const createdAt = now();
  const base = { workspaceId, candidateId: source.candidateId, createdAt };
  const items = claims.map((claim): EvidenceItem => ({
    ...claim,
    ...base,
    id: newId(),
    sourceId,
    synthetic: source.synthetic,
  }));
  const notes = mergeNotes(instructions, hiddenText(layout)).map((n): SourceNote => ({
    ...base,
    id: newId(),
    sourceId,
    reason: n.reason,
    excerpt: n.excerpt,
    excerptSpan: pageSpan(layout, n.start),
  }));
  await store.insertItems(items, notes);
  await recordContact(tx, workspaceId, source.candidateId, contact);
  // A repository the CV links is read like an application's link. No login and no emails: CV contact is unverified, so
  // it never makes commits count as the candidate's (the read then says authorship is unclear).
  for (const url of repositoryLinks(layout.content, instructions))
    await queueRead(tx, workspaceId, {
      candidateId: source.candidateId,
      url,
      githubLogin: null,
      emails: [],
      synthetic: source.synthetic,
    });
  if (items.length)
    await publishRecorded(
      tx,
      source,
      items.map((i) => i.id),
    );
  // The audit write is the last statement before commit (AGENTS.md 3.6).
  if (name && applicant.unnamed) await nameApplicant(tx, workspaceId, source.candidateId, name);
  return { status: 'parsed', notes: notes.length };
}
