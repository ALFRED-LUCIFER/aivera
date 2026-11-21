import { detectUnusualContent } from '@credalent/ai';
import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import type { SourceNote } from '../domain/cv.ts';
import { checkSource, EvidenceError, type EvidenceItem, type EvidenceSource } from '../domain/evidence.ts';
import { fingerprintText } from '../domain/fingerprint.ts';
import { extractPage, linkItem, MAX_LINK_LENGTH, type LinkReadStatus } from '../domain/link.ts';
import type { CvParseStore, ParsePorts } from './cvParse.ts';
import { flagCrossApplicantCopies, type Ports } from './evidence.ts';

/** `url` is the link exactly as supplied, shown as text with "We could not open this link"; never logged. */
export type LinkRead = {
  workspaceId: string;
  sourceId: string;
  candidateId: string;
  url: string;
  status: LinkReadStatus;
  title: string | null;
};

/** Why a fetch made no page; for tests and the store's `not_reachable`, never shown or logged with the URL. */
export type FetchFailure =
  | 'refused_url'
  | 'refused_address'
  | 'robots'
  | 'redirects'
  | 'too_large'
  | 'not_html'
  | 'status'
  | 'timeout'
  | 'network';
/** Fetches a candidate-supplied link behind the SSRF guard (infrastructure/linkFetch.ts); never throws. */
export type FetchPage = (url: string) => Promise<{ ok: true; html: string } | { ok: false; reason: FetchFailure }>;

/** Over one workspace-scoped transaction; every method filters by `workspaceId`. */
export type LinkReadStore = {
  /** Stores the source and its pending read; returns the existing read's source id for the same candidate and URL. */
  insertOrGet(source: EvidenceSource, read: LinkRead): Promise<string | null>;
  find(workspaceId: string, sourceId: string): Promise<{ read: LinkRead; source: EvidenceSource } | null>;
  /** Sets the status (and title) only while pending or failed; false when another delivery finished it first. */
  finish(
    workspaceId: string,
    sourceId: string,
    status: Exclude<LinkReadStatus, 'pending'>,
    title?: string | null,
  ): Promise<boolean>;
  setFingerprint(workspaceId: string, sourceId: string, textFingerprint: string | null): Promise<void>;
};

export type RequestLinkReadInput = {
  candidateId: string;
  /** As the candidate supplied it; a URL the guard refuses is stored and read as not reachable, with no request. */
  url: string;
  /** How the citation names it: "Shipped product: merchant help assistant". */
  label: string;
  synthetic: boolean;
};

export type LinkReadView = {
  status: LinkReadStatus;
  url: string;
  /** The source label every note is cited by (a page has no page numbers). */
  label: string;
  title: string | null;
  notes: Pick<SourceNote, 'reason' | 'excerpt'>[];
};

export type LinkPorts = Pick<Ports, 'newId' | 'now'> & {
  linkStoreFor(tx: Tx): LinkReadStore;
  /** Writes `LinkReadRequested.v1` to the outbox in `tx`. */
  publishLinkReadRequested(tx: Tx, source: EvidenceSource): Promise<void>;
};

/**
 * Stores a pending `shipped_product` source for the link and queues its read, once per candidate and URL. Throws
 * `EvidenceError('source_url')` for an empty link or one longer than MAX_LINK_LENGTH.
 */
export async function queueLinkRead(
  ports: LinkPorts,
  tx: Tx,
  workspaceId: string,
  input: RequestLinkReadInput,
): Promise<{ sourceId: string; queued: boolean }> {
  const at = ports.now();
  const url = input.url.trim();
  if (!url || url.length > MAX_LINK_LENGTH) throw new EvidenceError('source_url');
  const source: EvidenceSource = {
    id: ports.newId(),
    workspaceId,
    candidateId: input.candidateId,
    kind: 'shipped_product',
    label: input.label.trim(),
    // The source keeps only an https link (checkSource); the read keeps the link as supplied.
    url: URL.parse(url)?.protocol === 'https:' ? url : null,
    blobFileId: null,
    capturedAt: at,
    checkedAt: null,
    checkMethod: null,
    synthetic: input.synthetic,
    createdAt: at,
    textFingerprint: null,
  };
  checkSource(source);
  const read: LinkRead = {
    workspaceId,
    sourceId: source.id,
    candidateId: input.candidateId,
    url,
    status: 'pending',
    title: null,
  };
  const existing = await ports.linkStoreFor(tx).insertOrGet(source, read);
  if (existing) return { sourceId: existing, queued: false };
  await ports.publishLinkReadRequested(tx, source);
  return { sourceId: source.id, queued: true };
}

export function linkReadUseCases(
  p: LinkPorts & Pick<Ports, 'authorize'> & { cvStoreFor(tx: Tx): Pick<CvParseStore, 'notes'> },
) {
  return {
    async requestLinkRead(ctx: WorkspaceContext, input: RequestLinkReadInput): Promise<{ sourceId: string }> {
      await p.authorize(ctx, 'candidate.create');
      const { sourceId } = await queueLinkRead(p, ctx.tx, ctx.workspaceId, input);
      return { sourceId };
    },

    async getLinkRead(ctx: WorkspaceContext, sourceId: string): Promise<LinkReadView | null> {
      await p.authorize(ctx, 'candidate.view');
      const found = await p.linkStoreFor(ctx.tx).find(ctx.workspaceId, sourceId);
      if (!found) return null;
      const notes = await p.cvStoreFor(ctx.tx).notes(ctx.workspaceId, sourceId);
      return {
        status: found.read.status,
        url: found.read.url,
        label: found.source.label,
        title: found.read.title,
        notes: notes.map(({ reason, excerpt }) => ({ reason, excerpt })),
      };
    },
  };
}

export type LinkWorkerPorts = Pick<ParsePorts, 'cvStoreFor' | 'publishRecorded'> &
  Pick<Ports, 'storeFor' | 'newId' | 'now' | 'logFlagged' | 'sha1'> & {
    linkStoreFor(tx: Tx): LinkReadStore;
    fetchPage: FetchPage;
  };

/**
 * The worker job `evidence.link.read`: fetches the link behind the SSRF guard and stores the page title, one
 * Candidate-submitted item with the page text, the "Unusual content in this source" notes and the text's fingerprint
 * (flagging another applicant's near-duplicate), all in `tx`. No model reads the text here. A link the guard refuses
 * or that cannot be fetched is `not_reachable`, with nothing scored. A `failed` read runs again on a redelivery and a
 * finished one is never read twice. Returns the status and the number of notes, or null when there was nothing to do.
 */
// shortcut: the fetch (at most 10 s) runs inside the consumer's workspace transaction, as Document Intelligence does.
export async function readLink(
  ports: LinkWorkerPorts,
  tx: Tx,
  workspaceId: string,
  sourceId: string,
): Promise<{ status: LinkReadStatus; notes: number } | null> {
  const store = ports.linkStoreFor(tx);
  const found = await store.find(workspaceId, sourceId);
  if (found?.read.status !== 'pending' && found?.read.status !== 'failed') return null;
  const { source, read } = found;
  const unreachable = async () =>
    (await store.finish(workspaceId, sourceId, 'not_reachable'))
      ? { status: 'not_reachable' as const, notes: 0 }
      : null;

  const page = await ports.fetchPage(read.url);
  if (!page.ok) return unreachable();
  const { title, text } = extractPage(page.html);
  // SAFETY: the page text is data: notes flag what is aimed at an AI, and it is cut out of what mapping reads.
  const flagged = detectUnusualContent(text);
  const fields = linkItem(text, source.label, flagged);
  if (!fields) return unreachable();
  if (!(await store.finish(workspaceId, sourceId, 'read', title))) return null;

  const createdAt = ports.now();
  const base = { workspaceId, candidateId: source.candidateId, sourceId, createdAt };
  const item: EvidenceItem = { ...fields, ...base, id: ports.newId(), synthetic: source.synthetic };
  // A page has no pages: the note is cited by the source label alone.
  const notes = flagged.map((n): SourceNote => ({
    ...base,
    id: ports.newId(),
    reason: n.reason,
    excerpt: n.excerpt,
    excerptSpan: null,
  }));
  await ports.cvStoreFor(tx).insertItems([item], notes);
  // Fingerprinting (AIV-P1-071) gets the text once: `finish` above lets only one delivery past.
  const textFingerprint = fingerprintText(text, ports.sha1);
  await store.setFingerprint(workspaceId, sourceId, textFingerprint);
  await flagCrossApplicantCopies(ports, tx, { ...source, textFingerprint });
  await ports.publishRecorded(tx, source, [item.id]);
  return { status: 'read', notes: notes.length };
}
