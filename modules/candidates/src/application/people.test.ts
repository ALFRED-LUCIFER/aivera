import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import type { IdentifierType, Person } from '../domain/person.ts';
import { peopleUseCases, type Ports } from './people.ts';

// Which matches findOrCreatePerson merges automatically (AIV-P1-018); synthetic cast (docs/00-product/personas.md).
const ctx = { userId: 'ap', workspaceId: 'w1', role: 'recruiter', tx: {} } as unknown as WorkspaceContext;
const person = (id: string, displayName: string): Person => ({
  id,
  workspaceId: 'w1',
  displayName,
  emails: [],
  phones: [],
  location: null,
  synthetic: true,
  mergedIntoId: null,
  createdAt: new Date('2026-11-20T09:00:00.000Z'),
});

/** The arrival "Karim Nasser" matching each listed person by `types`, earliest first; the merges it asks for. */
async function arrive(matches: [Person, IdentifierType[]][]) {
  const autoMerge = vi.fn(async () => null);
  const useCases = peopleUseCases({
    storeFor: () =>
      ({
        findPeople: async () => matches.map(([p, types]) => ({ person: p, types })),
        attachIdentifiers: async () => {},
      }) as never,
    authorize: async () => {},
    autoMerge,
  } as unknown as Ports);
  const found = await useCases.findOrCreatePerson(ctx, {
    displayName: 'Karim Nasser',
    identifiers: [
      { type: 'github_login', value: 'knasser' },
      { type: 'cv_hash', value: '1'.padStart(64, '0') },
    ],
    synthetic: true,
  });
  return { found, merges: autoMerge.mock.calls };
}

describe('findOrCreatePerson merges only exact duplicates of the arrival', () => {
  it('merges a match by CV file into the earliest, which the arrival matches by email', async () => {
    const { found, merges } = await arrive([
      [person('a', 'Karim Nasser'), ['email']],
      [person('b', 'Karim Nasser'), ['cv_hash']],
    ]);
    expect(found).toEqual({ personId: 'a', created: false });
    expect(merges).toEqual([[ctx, 'a', 'b', 'merged automatically: same CV file']]);
  });

  // SAFETY: mutation check: treated every match as exact in useMatches -> this test failed (found a, b merged into it)
  // SAFETY: mutation check: targeted matches[0] instead of the earliest exact match -> this test failed (found a)
  it('joins the person the arrival exactly duplicates, not an earlier one that shares only a GitHub login under another name', async () => {
    const { found, merges } = await arrive([
      [person('a', 'Omar Al Suwaidi'), ['github_login']],
      [person('b', 'Karim Nasser'), ['cv_hash']],
    ]);
    expect(found).toEqual({ personId: 'b', created: false });
    expect(merges).toEqual([]);
  });
});
