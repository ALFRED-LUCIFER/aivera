import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSealer } from './seal.ts';

const key = randomBytes(32).toString('base64');

describe('createSealer', () => {
  it('round-trips a value and never stores it in the clear', () => {
    const sealer = createSealer(key);
    const sealed = sealer.seal({ to: 'sara.alqahtani@example.com' });
    expect(sealed).not.toContain('example.com');
    expect(sealer.open(sealed)).toEqual({ to: 'sara.alqahtani@example.com' });
  });

  it('refuses a tampered value and a value sealed with another key', () => {
    const sealed = createSealer(key).seal({ to: 'sara.alqahtani@example.com' });
    const [v, iv, tag, body] = sealed.split('.');
    const flipped = Buffer.from(body ?? '', 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => createSealer(key).open([v, iv, tag, flipped.toString('base64')].join('.'))).toThrow();
    expect(() => createSealer(randomBytes(32).toString('base64')).open(sealed)).toThrow();
  });

  it('hashes an address the same way whatever its case, without containing it', () => {
    const sealer = createSealer(key);
    const hash = sealer.hash('Sara.AlQahtani@example.com');
    expect(hash).toBe(sealer.hash(' sara.alqahtani@example.com '));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createSealer(randomBytes(16).toString('base64'))).toThrow('32 bytes');
  });
});
