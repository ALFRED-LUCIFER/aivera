import { describe, expect, it } from 'vitest';
import { decide, MAX_DELIVERIES } from './consumer.ts';

// AIV-P0-015: the retry and dead-letter decision table.
describe('decide', () => {
  it.each([
    ['handled', 1, { action: 'complete' }],
    ['handled', MAX_DELIVERIES, { action: 'complete' }],
    [{ invalid: 'invalid payload' }, 1, { action: 'deadLetter', reason: 'invalid payload' }],
    [{ invalid: 'unknown event type' }, 3, { action: 'deadLetter', reason: 'unknown event type' }],
    ['failed', 1, { action: 'abandon', delayMs: 1000 }],
    ['failed', 2, { action: 'abandon', delayMs: 2000 }],
    ['failed', 3, { action: 'abandon', delayMs: 4000 }],
    ['failed', 9, { action: 'abandon', delayMs: 30_000 }],
    ['failed', MAX_DELIVERIES, { action: 'deadLetter', reason: 'max deliveries' }],
  ] as const)('%j on delivery %i -> %j', (outcome, deliveryCount, settlement) => {
    expect(decide(outcome, deliveryCount)).toEqual(settlement);
  });
});
