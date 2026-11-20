import type { Tx } from '@credalent/db';
import { describe, expect, it } from 'vitest';
import {
  queueArrivalReads,
  type Arrival,
  type ArrivalPorts,
  type RepositoryRead,
  type RepositoryReadStore,
} from './repositoryRead.ts';

// AIV-P1-076: which links an arrival queues, and who the commits are matched to. Synthetic cast only.
const W = '0190d4a2-0000-7000-8000-000000000001';
const MARIA = '0190d4a2-0000-7000-8000-0000000000a5';

function run(arrival: Arrival) {
  const reads: RepositoryRead[] = [];
  let n = 0;
  const ports: ArrivalPorts = {
    readArrival: async () => arrival,
    readPerson: async () => ({ emails: [' Maria.Santos@example.com '], synthetic: true }),
    // Only insertOrGet is reached when queueing.
    readStoreFor: () =>
      ({
        insertOrGet: async (_source: unknown, read: RepositoryRead) =>
          reads.find((r) => r.url === read.url)?.sourceId ?? (reads.push(read), null),
      }) as unknown as RepositoryReadStore,
    publishReadRequested: async () => undefined,
    logQueued: () => undefined,
    newId: () => `0190d4a2-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    now: () => new Date('2026-11-20T09:00:00Z'),
  };
  return queueArrivalReads(ports, {} as Tx, W, 'arrival').then(() => reads);
}

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
