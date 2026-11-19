import { describe, expect, it } from 'vitest';
import type { Db } from './client.ts';
import { withCandidateAccount, withWorkspace } from './withWorkspace.ts';

const db = { transaction: () => Promise.reject(new Error('must not open a transaction')) } as unknown as Db;

describe('withWorkspace', () => {
  // An empty or malformed id must never reach set_config: an empty setting would mean "no workspace".
  it.each(['', 'not-a-uuid', "1'; drop table x; --"])('rejects %j before opening a transaction', async (id) => {
    await expect(withWorkspace(db, id, async () => 1)).rejects.toThrow('withWorkspace needs a workspace id');
  });
});

describe('withCandidateAccount', () => {
  it.each(['', 'not-a-uuid', "1'; drop table x; --"])('rejects %j before opening a transaction', async (id) => {
    await expect(withCandidateAccount(db, id, async () => 1)).rejects.toThrow(
      'withCandidateAccount needs a candidate account id',
    );
  });
});
