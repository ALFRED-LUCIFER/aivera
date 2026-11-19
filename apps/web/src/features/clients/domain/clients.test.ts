import { describe, expect, it } from 'vitest';
import { clientNameSchema, openJobsByClient } from './clients.ts';

describe('openJobsByClient', () => {
  it('counts each client’s jobs that are not closed; team jobs count for no client', () => {
    const counts = openJobsByClient([
      { clientId: 'dune', stage: 'defining_rubric' },
      { clientId: 'dune', stage: 'round_1' },
      { clientId: 'dune', stage: 'closed' },
      { clientId: 'falcon', stage: 'closed' },
      { clientId: null, stage: 'round_1' },
    ]);
    expect([...counts]).toEqual([['dune', 2]]);
    expect(counts.get('falcon') ?? 0).toBe(0);
  });
});

describe('clientNameSchema', () => {
  it('trims, and refuses an empty or over-long name', () => {
    expect(clientNameSchema.parse('  Falcon Pay ')).toBe('Falcon Pay');
    expect(clientNameSchema.safeParse('   ').success).toBe(false);
    expect(clientNameSchema.safeParse('x'.repeat(121)).success).toBe(false);
  });
});
