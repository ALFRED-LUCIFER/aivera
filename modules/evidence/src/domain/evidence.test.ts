import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkItem,
  checkItems,
  checkLink,
  checkSource,
  PROVENANCES,
  STRENGTHS,
  type EvidenceItem,
} from './evidence.ts';

const item = (over: Partial<EvidenceItem> = {}) => ({
  excerpt: 'authored 412 of 460 commits',
  provenance: 'corroborated' as const,
  strength: 'strong' as const,
  limit: 'Shows the tooling, not how results changed product decisions.',
  ...over,
});

describe('evidence items (AIV-P1-024)', () => {
  // SAFETY: mutation check: removed the claim_strength check from checkItem -> this test failed
  it.each([
    ['claim', 'medium'],
    ['claim', 'strong'],
    ['awaiting-defence', 'medium'],
  ] as const)('a %s item cannot be %s: "A claim cannot be stronger than Supporting"', (provenance, strength) => {
    expect(() => checkItem(item({ provenance, strength }))).toThrow('A claim cannot be stronger than Supporting');
  });

  it.each(['supporting', 'claim'] as const)('a claim may be %s', (strength) => {
    expect(() => checkItem(item({ provenance: 'claim', strength }))).not.toThrow();
    expect(() => checkItem(item({ provenance: 'awaiting-defence', strength }))).not.toThrow();
  });

  it.each(PROVENANCES)('provenance %s is accepted', (provenance) => {
    expect(() => checkItem(item({ provenance, strength: 'supporting' }))).not.toThrow();
  });

  it('provenance and strength are closed lists', () => {
    expect(() => checkItem(item({ provenance: 'verified' as never }))).toThrow('The provenance is not one of');
    expect(() => checkItem(item({ strength: 'weak' as never }))).toThrow('The strength is not one of');
  });

  // SAFETY: mutation check: removed the limit check from checkItem -> this test failed
  it.each(['', '   '])('an item with limit %j is rejected: "State what this evidence does not show"', (limit) => {
    expect(() => checkItem(item({ limit }))).toThrow('State what this evidence does not show');
  });

  // SAFETY: mutation check: emptied checkItems -> this test failed
  it('a source with no items is refused', () => {
    expect(() => checkItems([])).toThrow('Record at least one item the source backs');
  });

  it('an item needs an excerpt', () => {
    expect(() => checkItem(item({ excerpt: ' ' }))).toThrow('Quote the excerpt');
  });
});

describe('evidence sources', () => {
  const source = { kind: 'repository' as const, label: 'llm-eval-harness', url: 'https://code.credalent.example/x' };

  it('a source needs a listed kind, a name and an https link if any', () => {
    expect(() => checkSource(source)).not.toThrow();
    expect(() => checkSource({ ...source, url: null, kind: 'reference_call' })).not.toThrow();
    expect(() => checkSource({ ...source, kind: 'tweet' as never })).toThrow('The source kind');
    expect(() => checkSource({ ...source, label: ' ' })).toThrow('Name the source');
    for (const url of ['javascript:alert(1)', 'http://code.credalent.example/x', 'not a url'])
      expect(() => checkSource({ ...source, url })).toThrow('A source link must be an https address');
  });
});

describe('labels', () => {
  const en = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../packages/i18n/messages/en.json'), 'utf8'));

  it('every provenance and strength has an English label in packages/i18n', () => {
    for (const p of PROVENANCES) expect(en.evidence.provenance[p]).toEqual(expect.any(String));
    for (const s of STRENGTHS) expect(en.rubric.strength[s]).toEqual(expect.any(String));
  });
});

describe('competency link levels (AIV-P1-030)', () => {
  it.each([0, 3, 5])('level %s is accepted', (level) => expect(() => checkLink({ level })).not.toThrow());
  it.each([6, -1, 2.5])('level %s is refused with "A level is a whole number from 0 to 5"', (level) =>
    expect(() => checkLink({ level })).toThrow('A level is a whole number from 0 to 5'),
  );
});
