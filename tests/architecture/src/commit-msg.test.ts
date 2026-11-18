import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs hook script without type declarations
import { hasTicketKey } from '../../../tools/check-commit-msg/check.mjs';

describe('commit-msg hook (ADR-007)', () => {
  it.each([
    'AIV-P0-002: add migration runner',
    'AIV-P1-E03: epic notes',
    'fix(AIV-P2-014): scorecard total',
    'Merge branch main',
  ])('accepts %j', (message) => expect(hasTicketKey(message)).toBe(true));
  it.each(['add migration runner', 'AIV-002: wrong shape', 'fix stuff\n\nAIV-P0-002 only in the body'])(
    'rejects %j',
    (message) => expect(hasTicketKey(message)).toBe(false),
  );
});
