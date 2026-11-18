import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuidv7.ts';

describe('uuidv7', () => {
  it('encodes the time in the first 48 bits, with version 7 and the RFC variant', () => {
    expect(uuidv7(0x0190d4a2b3c4)).toMatch(/^0190d4a2-b3c4-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sorts by creation time', () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });
});
