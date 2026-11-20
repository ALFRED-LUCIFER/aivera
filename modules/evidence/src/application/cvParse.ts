import {
  AiUnavailable,
  BudgetExceeded,
  detectUnusualContent,
  InvalidCitation,
  SchemaMismatch,
  UncitedOutput,
} from '@credalent/ai';
import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import {
  CV_LABEL,
  cvClaims,
  hiddenText,
  looksLike,
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
  insert(parse: CvParse): Promise<void>;
  find(workspaceId: string, sourceId: string): Promise<{ parse: CvParse; source: EvidenceSource } | null>;
  /** The parses of a CV file still to run (pending, or failed and waiting for a redelivery), by source id. */
  pendingForFile(workspaceId: string, fileId: string): Promise<string[]>;
  /** Sets the status only while pending or failed; false when another delivery finished it first. */
  finish(workspaceId: string, sourceId: string, status: Exclude<CvParseStatus, 'pending'>): Promise<boolean>;
  insertItems(items: EvidenceItem[], notes: SourceNote[]): Promise<void>;
  notes(workspaceId: string, sourceId: string): Promise<SourceNote[]>;
};

export type CvPorts = Pick<Ports, 'storeFor' | 'authorize' | 'newId' | 'now'> & {
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

export function cvParseUseCases({ storeFor, cvStoreFor, publishParseRequested, authorize, newId, now }: CvPorts) {
  return {
    /** Stores a pending `cv` source for the file and asks the worker to parse it (`evidence.cv.parse`). */
    // shortcut: the file is not checked to belong to the candidate (files carry no owner link); the caller (the intake
    // channel, AIV-P1-019) must pass only the candidate's own application's CV file ids.
    async requestCvParse(ctx: WorkspaceContext, input: RequestCvParseInput): Promise<{ sourceId: string }> {
      await authorize(ctx, 'candidate.create');
      const at = now();
      const source: EvidenceSource = {
        id: newId(),
        workspaceId: ctx.workspaceId,
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
      await storeFor(ctx.tx).insert(source, [], []);
      await cvStoreFor(ctx.tx).insert({
        workspaceId: ctx.workspaceId,
        sourceId: source.id,
        candidateId: input.candidateId,
        status: 'pending',
      });
      await publishParseRequested(ctx.tx, source);
      return { sourceId: source.id };
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
    /** `parseCvRequest` of @credalent/ai on the CV text as the one `cv` source, checked by the citation contract. */
    extract(workspaceId: string, sourceId: string, text: string): Promise<CvExtraction>;
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

/** Answers that will not change on a redelivery: the source shows "Parsing failed, retry" and the message completes. */
const AI_FAILURES = [BudgetExceeded, SchemaMismatch, UncitedOutput, InvalidCitation];

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
 * runs it again). A `failed` parse runs again on a redelivery. Throws the transient errors (`isTransient`). Returns the
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
    recordContact,
    queueRead,
    newId,
    now,
  } = ports;
  const store = cvStoreFor(tx);
  const found = await store.find(workspaceId, sourceId);
  const open = found?.parse.status === 'pending' || found?.parse.status === 'failed';
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
  let extraction: CvExtraction;
  try {
    extraction = await extract(workspaceId, sourceId, layout.content);
  } catch (error) {
    if (AI_FAILURES.some((kind) => error instanceof kind)) return end('failed');
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
  return { status: 'parsed', notes: notes.length };
}
