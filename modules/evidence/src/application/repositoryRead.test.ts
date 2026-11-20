import type { Tx } from '@credalent/db';
import { describe, expect, it } from 'vitest';
import {
  queueArrivalReads,
  type Arrival,
  type ArrivalPorts,
  type RepositoryRead,
  type RepositoryReadStore,
} from './repositoryRead.ts';
import type { CvParseStore } from './cvParse.ts';
import type { EvidenceSource } from '../domain/evidence.ts';

// AIV-P1-076: which links an arrival queues, and who the commits are matched to. Synthetic cast only.
const W = '0190d4a2-0000-7000-8000-000000000001';
const MARIA = '0190d4a2-0000-7000-8000-0000000000a5';

async function queue(
  arrival: Omit<Arrival, 'fileIds'> & { fileIds?: string[] },
  purposes: Record<string, string> = {},
) {
  const reads: RepositoryRead[] = [];
  const parses: EvidenceSource[] = [];
  const published: string[] = [];
  const logs: unknown[][] = [];
  let n = 0;
  const ports: ArrivalPorts = {
    readArrival: async () => ({ fileIds: [], ...arrival }),
    readPerson: async () => ({ emails: [' Maria.Santos@example.com '], synthetic: true }),
    readFilePurpose: async (_tx, _w, fileId) => purposes[fileId] ?? null,
    // Only insertOrGet is reached when queueing.
    readStoreFor: () =>
      ({
        insertOrGet: async (_source: unknown, read: RepositoryRead) =>
          reads.find((r) => r.url === read.url)?.sourceId ?? (reads.push(read), null),
      }) as unknown as RepositoryReadStore,
    cvStoreFor: () =>
      ({
        insertOrGet: async (source: EvidenceSource) =>
          parses.find((p) => p.candidateId === source.candidateId && p.blobFileId === source.blobFileId)?.id ??
          (parses.push(source), null),
      }) as unknown as CvParseStore,
    publishReadRequested: async () => undefined,
    publishParseRequested: async (_tx, source) => void published.push(source.id),
    logQueued: (...args) => void logs.push(args),
    newId: () => `0190d4a2-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    now: () => new Date('2026-11-20T09:00:00Z'),
  };
  await queueArrivalReads(ports, {} as Tx, W, 'arrival');
  return { reads, parses, published, logs };
}

const run = async (arrival: Omit<Arrival, 'fileIds'>) => (await queue(arrival)).reads;

describe('queueing the reads an arrival brings', () => {
  it('queues one read per repository, whatever the spelling, and leaves every other link alone', async () => {
    const reads = await run({
      personId: MARIA,
      githubLogin: null,
      links: [
        'https://github.com/maria-credalent-example/ledger-sync',
        'https://github.com/Maria-Credalent-Example/ledger-sync.git',
        'https://portfolio.maria.credalent.example',
        'https://github.com/maria-credalent-example',
      ],
    });
    expect(reads.map((r) => r.url)).toEqual(['https://github.com/maria-credalent-example/ledger-sync']);
  });

  it('with no login supplied, matches by the emails on her record only: never her name, email or the owner', async () => {
    const [read] = await run({
      personId: MARIA,
      githubLogin: null,
      links: ['https://github.com/maria-credalent-example/ledger-sync'],
    });
    expect(read).toMatchObject({ candidateId: MARIA, githubLogin: null, emails: ['maria.santos@example.com'] });
  });

  it('uses the login she supplied, and drops one that is not a GitHub login rather than guess', async () => {
    const link = ['https://github.com/sara-credalent-example/merchant-assistant'];
    expect((await run({ personId: MARIA, githubLogin: '@Sara-Credalent-Example', links: link }))[0]?.githubLogin).toBe(
      'sara-credalent-example',
    );
    expect((await run({ personId: MARIA, githubLogin: 'not a login', links: link }))[0]?.githubLogin).toBeNull();
  });
});

// AIV-P1-079: which files an arrival parses as a CV.
describe('queueing the CV parses an arrival brings', () => {
  const CV = '0190d4a2-0000-7000-8000-00000000c001';
  const PORTFOLIO = '0190d4a2-0000-7000-8000-00000000c002';
  const DOCUMENT = '0190d4a2-0000-7000-8000-00000000c003';

  it('queues one parse per cv file, for the arrival person, and none for evidence, portal or unknown files', async () => {
    const { parses, published, logs } = await queue(
      { personId: MARIA, githubLogin: null, links: [], fileIds: [CV, PORTFOLIO, DOCUMENT, 'missing', CV] },
      { [CV]: 'cv', [PORTFOLIO]: 'portal', [DOCUMENT]: 'evidence' },
    );
    expect(parses.map((p) => [p.kind, p.candidateId, p.blobFileId, p.synthetic])).toEqual([['cv', MARIA, CV, true]]);
    expect(published).toEqual([parses[0]?.id]);
    // Opaque ids only: never a file name, content type or contact detail.
    expect(logs).toEqual([['cv', { sourceId: parses[0]?.id, candidateId: MARIA, queued: true }]]);
  });
});
