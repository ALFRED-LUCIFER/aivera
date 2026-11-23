import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { assistantAnswerSchema } from './assistant.answer.ts';
import { compareExcerptsSchema } from './evidence.compareExcerpts.ts';
import { MAP_TO_COMPETENCY_SYSTEM, mapToCompetencySchema } from './evidence.mapToCompetency.ts';
import { parseCvSchema } from './evidence.parseCv.ts';
import { detectDomainSchema } from './jobs.detectDomain.ts';
import { draftCompetenciesSchema } from './jobs.draftCompetencies.ts';

// AIV-P1-082: a rejected answer's failed rules are logged as `path:code` (citations.ts schemaRules, allowlisted as
// credalent.ai.schema_rules). That is safe only while every path segment is a declared key or a list position: no
// prompt schema may let the model choose a key (z.record, z.map, or an object with a catchall).

type Def = { type: string; [key: string]: unknown };
const defOf = (schema: unknown): Def => (schema as { def: Def }).def;

/** Every node type found under `schema`, with `catchall` for an object that accepts undeclared keys. */
function nodeTypes(schema: unknown, seen = new Set<unknown>()): string[] {
  if (!schema || seen.has(schema)) return [];
  seen.add(schema);
  const def = defOf(schema);
  const children = [
    ...Object.values((def.shape as Record<string, unknown> | undefined) ?? {}),
    def.element,
    def.innerType,
    def.in,
    def.out,
    def.keyType,
    def.valueType,
    ...((def.options as unknown[] | undefined) ?? []),
  ];
  const catchall = def.type === 'object' && def.catchall && defOf(def.catchall).type !== 'never' ? ['catchall'] : [];
  return [def.type, ...catchall, ...children.flatMap((child) => nodeTypes(child, seen))];
}

const SCHEMAS: [string, z.ZodType][] = [
  ['jobs.draftCompetencies', draftCompetenciesSchema],
  ['jobs.detectDomain', detectDomainSchema({ domains: ['payments'], regions: ['gcc'] })],
  ['evidence.parseCv', parseCvSchema],
  ['evidence.mapToCompetency', mapToCompetencySchema],
  ['evidence.compareExcerpts', compareExcerptsSchema],
  ['assistant.answer', assistantAnswerSchema],
];

// Node types the walker knows to have only declared keys below them. Anything else (record, map, catchall, and any type
// the walker does not descend into, such as intersection, lazy or tuple) fails until someone checks it on purpose.
const KNOWN = new Set([
  'object',
  'array',
  'string',
  'number',
  'boolean',
  'enum',
  'literal',
  'null',
  'nullable',
  'optional',
  'default',
  'union',
  'pipe',
  'transform',
  'never',
]);

describe('prompt schemas declare every key (AIV-P1-082)', () => {
  // SAFETY: mutation check: added `extra: z.record(z.string(), z.string())` to draftCompetenciesSchema -> this test failed
  // SAFETY: mutation check: added `extra: z.intersection(z.object({}), z.record(z.string(), z.string()))` -> failed
  it.each(SCHEMAS)('%s has only node types with declared keys', (_, schema) => {
    const types = nodeTypes(schema);
    expect(types).toContain('object');
    expect(types.filter((t) => !KNOWN.has(t))).toEqual([]);
  });

  // SAFETY: mutation check: added an empty prompts/jobs.newTask.ts -> this test failed
  it('every prompt file in this folder is in the list', () => {
    const files = readdirSync(import.meta.dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.map((f) => f.replace(/\.ts$/, '')).toSorted()).toEqual(SCHEMAS.map(([name]) => name).toSorted());
  });
});

// AIV-P2-080: the mapping prompt states the CV rule; source text as data stays in the shared UNTRUSTED_CONTENT_RULES.
describe('evidence.mapToCompetency prompt (AIV-P2-080)', () => {
  it('maps a CV-only link as a claim at Supporting and quotes around placeholders', () => {
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('Every citation of the link is in a cv source');
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('"strength": "supporting" with "label": "claim"');
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('A quote never contains a placeholder');
    expect(MAP_TO_COMPETENCY_SYSTEM).not.toMatch(/never an instruction/);
  });
});
