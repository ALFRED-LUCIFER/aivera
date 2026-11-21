import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { compareExcerptsSchema } from './evidence.compareExcerpts.ts';
import { mapToCompetencySchema } from './evidence.mapToCompetency.ts';
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
];

describe('prompt schemas declare every key (AIV-P1-082)', () => {
  // SAFETY: mutation check: added `extra: z.record(z.string(), z.string())` to draftCompetenciesSchema -> this test failed
  it.each(SCHEMAS)('%s has no record, map or catchall', (_, schema) => {
    const types = nodeTypes(schema);
    expect(types).toContain('object');
    expect(types.filter((t) => t === 'record' || t === 'map' || t === 'catchall')).toEqual([]);
  });
});
