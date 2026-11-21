import { detectUnusualContent } from '@credalent/ai';
import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import { hiddenText, mergeNotes, pageSpan, type CvLayout, type SourceNote } from '../domain/cv.ts';
import { DOCUMENT_PURPOSES, documentItems, isDocument, type DocumentReadStatus } from '../domain/document.ts';
import { checkSource, type EvidenceItem, type EvidenceSource } from '../domain/evidence.ts';
import { fingerprintText } from '../domain/fingerprint.ts';
import { DocumentUnreadable, type CvParseStore, type ParsePorts } from './cvParse.ts';
import { flagCrossApplicantCopies, type Ports } from './evidence.ts';

export type DocumentRead = { workspaceId: string; sourceId: string; candidateId: string; status: DocumentReadStatus };

/** Over one workspace-scoped transaction; every method filters by `workspaceId`. */
export type DocumentReadStore = {
  insert(read: DocumentRead): Promise<void>;
  find(workspaceId: string, sourceId: string): Promise<{ read: DocumentRead; source: EvidenceSource } | null>;
  /** The reads of a file still to run (pending, or failed and waiting for a redelivery), by source id. */
  pendingForFile(workspaceId: string, fileId: string): Promise<string[]>;
  /** Sets the status only while pending or failed; false when another delivery finished it first. */
  finish(workspaceId: string, sourceId: string, status: Exclude<DocumentReadStatus, 'pending'>): Promise<boolean>;
  setFingerprint(workspaceId: string, sourceId: string, textFingerprint: string | null): Promise<void>;
};

export type RequestDocumentReadInput = {
  candidateId: string;
  /** The files module's id of the uploaded document (purpose `evidence` or `portal`); read once it is clean. */
  fileId: string;
  /** How the citation names it: "Requirements document", "Outcome write-up". */
  label: string;
  synthetic: boolean;
};

export type DocumentReadView = {
  status: DocumentReadStatus;
  /** "Unusual content in this source" notes, document order, each cited "page N"; they change nothing else. */
  notes: Pick<SourceNote, 'reason' | 'excerpt' | 'excerptSpan'>[];
};

export type DocumentPorts = Pick<Ports, 'storeFor' | 'authorize' | 'newId' | 'now'> & {
  documentStoreFor(tx: Tx): DocumentReadStore;
  cvStoreFor(tx: Tx): CvParseStore;
  /** Writes `DocumentReadRequested.v1` to the outbox in `tx`. */
  publishReadRequested(tx: Tx, source: EvidenceSource): Promise<void>;
};

export function documentReadUseCases(p: DocumentPorts) {
  return {
    /** Stores a pending `document` source for the file and asks the worker to read it (`evidence.document.read`). */
    // shortcut: the file is not checked to belong to the candidate (files carry no owner link); the caller (the portal,
    // AIV-P1-041 and AIV-P1-042) must pass only the candidate's own upload ids.
    async requestDocumentRead(ctx: WorkspaceContext, input: RequestDocumentReadInput): Promise<{ sourceId: string }> {
      await p.authorize(ctx, 'candidate.create');
      const at = p.now();
      const source: EvidenceSource = {
        id: p.newId(),
        workspaceId: ctx.workspaceId,
        candidateId: input.candidateId,
        kind: 'document',
        label: input.label.trim(),
        url: null,
        blobFileId: input.fileId,
        capturedAt: at,
        checkedAt: null,
        checkMethod: null,
        synthetic: input.synthetic,
        createdAt: at,
        textFingerprint: null,
      };
      checkSource(source);
      await p.storeFor(ctx.tx).insert(source, [], []);
      await p.documentStoreFor(ctx.tx).insert({
        workspaceId: ctx.workspaceId,
        sourceId: source.id,
        candidateId: input.candidateId,
        status: 'pending',
      });
      await p.publishReadRequested(ctx.tx, source);
      return { sourceId: source.id };
    },

    async getDocumentRead(ctx: WorkspaceContext, sourceId: string): Promise<DocumentReadView | null> {
      await p.authorize(ctx, 'candidate.view');
      const found = await p.documentStoreFor(ctx.tx).find(ctx.workspaceId, sourceId);
      if (!found) return null;
      const notes = await p.cvStoreFor(ctx.tx).notes(ctx.workspaceId, sourceId);
      return {
        status: found.read.status,
        notes: notes.map(({ reason, excerpt, excerptSpan }) => ({ reason, excerpt, excerptSpan })),
      };
    },
  };
}

export type ReadPorts = Pick<ParsePorts, 'cvStoreFor' | 'publishRecorded' | 'readCleanFile' | 'documentIntelligence'> &
  Pick<Ports, 'storeFor' | 'newId' | 'now' | 'logFlagged' | 'sha1'> & {
    documentStoreFor(tx: Tx): DocumentReadStore;
  };

/**
 * The worker job `evidence.document.read`: reads the clean file with Document Intelligence and stores one
 * Candidate-submitted item per page, the "Unusual content in this source" notes (embedded instructions, hidden text), and
 * the text's fingerprint (flagging another applicant's near-duplicate), all in `tx`. No model reads the text here. A file
 * still in quarantine leaves the read pending (FileClean.v1 runs it again); a `failed` read runs again on a redelivery,
 * and a finished one is never read twice. Throws DocumentIntelligenceUnavailable. Returns the status and the number of
 * notes, or null when there was nothing to do.
 */
// shortcut: Document Intelligence runs inside the consumer's workspace transaction, as the CV parse does.
export async function readDocument(
  ports: ReadPorts,
  tx: Tx,
  workspaceId: string,
  sourceId: string,
): Promise<{ status: DocumentReadStatus; notes: number } | null> {
  const store = ports.documentStoreFor(tx);
  const found = await store.find(workspaceId, sourceId);
  const open = found?.read.status === 'pending' || found?.read.status === 'failed';
  const fileId = found?.source.blobFileId;
  if (!found || !open || !fileId) return null;
  const { source } = found;
  // SAFETY: bytes only once the files module settled the file clean; a file in quarantine or infected is never read.
  const file = await ports.readCleanFile(tx, workspaceId, fileId);
  if (file === 'pending') return null;
  const end = async (status: 'unreadable') =>
    (await store.finish(workspaceId, sourceId, status)) ? { status, notes: 0 } : null;
  // Infected, rejected or missing, even when FileRejected.v1 ran before this read was requested.
  if (file === 'rejected') return end('unreadable');

  if (!DOCUMENT_PURPOSES.includes(file.purpose) || !isDocument(file.contentType, file.data)) return end('unreadable');
  let layout: CvLayout;
  try {
    layout = await ports.documentIntelligence.analyze(file.data, file.contentType);
  } catch (error) {
    if (error instanceof DocumentUnreadable) return end('unreadable');
    throw error;
  }
  if (!layout.content.trim()) return end('unreadable');
  if (!(await store.finish(workspaceId, sourceId, 'read'))) return null;

  const flagged = mergeNotes(detectUnusualContent(layout.content), hiddenText(layout));
  const createdAt = ports.now();
  const base = { workspaceId, candidateId: source.candidateId, sourceId, createdAt };
  const items = documentItems(layout, source.label, flagged).map((item): EvidenceItem => ({
    ...item,
    ...base,
    id: ports.newId(),
    synthetic: source.synthetic,
  }));
  const notes = flagged.map((n): SourceNote => ({
    ...base,
    id: ports.newId(),
    reason: n.reason,
    excerpt: n.excerpt,
    excerptSpan: pageSpan(layout, n.start),
  }));
  await ports.cvStoreFor(tx).insertItems(items, notes);
  // Fingerprinting (AIV-P1-071) gets the text once: `finish` above lets only one delivery past.
  const textFingerprint = fingerprintText(layout.content, ports.sha1);
  await store.setFingerprint(workspaceId, sourceId, textFingerprint);
  await flagCrossApplicantCopies(ports, tx, { ...source, textFingerprint });
  if (items.length)
    await ports.publishRecorded(
      tx,
      source,
      items.map((i) => i.id),
    );
  return { status: 'read', notes: notes.length };
}
