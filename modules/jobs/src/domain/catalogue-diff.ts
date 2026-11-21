// What a catalogue draft changes against the latest published version (AIV-P2-049, ADR-013 point 13): the publish
// preview's list and the audit entry's change counts. Pure: no database, no clock.
import type { EditorCompetency, EditorHint, EditorVersion } from './catalogue-draft.ts';

export type DiffGroup = 'jobTypes' | 'packs' | 'competencies' | 'hints';
export type DiffField =
  | 'label'
  | 'evidence'
  | 'starters'
  | 'order'
  | 'name'
  | 'meaning'
  | 'level1'
  | 'level3'
  | 'level5'
  | 'appliesTo'
  | 'core'
  | 'levelNeeded';

/** One entry's change; `fields` lists an edit's before and after (empty when added or retired). */
export type CatalogueChange = {
  readonly group: DiffGroup;
  readonly kind: 'added' | 'edited' | 'retired';
  /** Stable within the diff: the entry's key, or its pack, region and position. */
  readonly id: string;
  /** The published name (the draft's for an added entry); empty for the job type order. */
  readonly name: string;
  readonly fields: readonly { readonly field: DiffField; readonly before: string; readonly after: string }[];
};

type Values = Partial<Record<DiffField, string>>;

const list = (keys: readonly string[]) => keys.join(', ');
const skill = (c: EditorCompetency | EditorHint): Values => ({
  name: c.name,
  meaning: c.meaning,
  evidence: c.evidence,
  level1: c.levels[1],
  level3: c.levels[3],
  level5: c.levels[5],
  appliesTo: list(c.appliesTo),
  ...('core' in c && { core: list(c.core) }),
  levelNeeded: String(c.levelNeeded),
});

/** The English labels of `from`'s job types that `other` holds too, in `from`'s order. */
const kept = (from: EditorVersion, other: EditorVersion) =>
  from.jobTypes.filter((t) => other.jobTypes.some((o) => o.key === t.key)).map((t) => t.label.en);

function change(
  group: DiffGroup,
  id: string,
  draft: { retired: boolean; name: string; values: Values },
  before: { retired: boolean; name: string; values: Values } | undefined,
): CatalogueChange[] {
  if (!before) return draft.retired ? [] : [{ group, kind: 'added', id, name: draft.name, fields: [] }];
  if (draft.retired) return before.retired ? [] : [{ group, kind: 'retired', id, name: before.name, fields: [] }];
  const fields = (Object.keys(draft.values) as DiffField[]).flatMap((field) => {
    const [b, a] = [before.values[field] ?? '', draft.values[field] ?? ''];
    return b === a ? [] : [{ field, before: b, after: a }];
  });
  return fields.length ? [{ group, kind: 'edited', id, name: before.name, fields }] : [];
}

/**
 * Every change of `draft` against `published`, grouped by job types, packs, competencies and regional hints, each in the
 * draft's order. English texts only (the editor edits nothing else). An entry new in the draft and removed again is
 * not in either version, so it is not a change.
 */
export function catalogueDiff(published: EditorVersion, draft: EditorVersion): CatalogueChange[] {
  const jobTypes = draft.jobTypes.flatMap((t) => {
    const before = published.jobTypes.find((b) => b.key === t.key);
    const values = (j: typeof t): Values => ({
      label: j.label.en,
      evidence: j.evidence.en,
      starters: list(j.starterCompetencies),
    });
    return change(
      'jobTypes',
      t.key,
      { retired: t.retired, name: t.label.en, values: values(t) },
      before && { retired: before.retired, name: before.label.en, values: values(before) },
    );
  });
  // A new job type's place is part of adding it; a reorder of published ones is one change of the Add a job order.
  const [orderBefore, orderAfter] = [list(kept(published, draft)), list(kept(draft, published))];
  const order: CatalogueChange[] =
    orderBefore === orderAfter
      ? []
      : [
          {
            group: 'jobTypes',
            kind: 'edited',
            id: 'order',
            name: '',
            fields: [{ field: 'order', before: orderBefore, after: orderAfter }],
          },
        ];

  const packs: CatalogueChange[] = [];
  const competencies: CatalogueChange[] = [];
  const hints: CatalogueChange[] = [];
  for (const pack of draft.packs) {
    const before = published.packs.find((p) => p.key === pack.key);
    packs.push(
      ...change(
        'packs',
        pack.key,
        { retired: pack.retired, name: pack.label.en, values: { label: pack.label.en } },
        before && { retired: before.retired, name: before.label.en, values: { label: before.label.en } },
      ),
    );
    for (const c of pack.competencies) {
      const b = before?.competencies.find((x) => x.position === c.position);
      competencies.push(
        ...change(
          'competencies',
          `${pack.key}:${c.position}`,
          { retired: c.retired, name: c.name, values: skill(c) },
          b && { retired: b.retired, name: b.name, values: skill(b) },
        ),
      );
    }
    for (const h of pack.hints) {
      const b = before?.hints.find((x) => x.region === h.region && x.position === h.position);
      hints.push(
        ...change(
          'hints',
          `${pack.key}:${h.region}:${h.position}`,
          { retired: h.retired, name: h.name, values: skill(h) },
          b && { retired: b.retired, name: b.name, values: skill(b) },
        ),
      );
    }
  }
  return [...jobTypes, ...order, ...packs, ...competencies, ...hints];
}

/** How many entries the diff adds, edits and retires: the `catalogue.published` audit entry's counts. */
export const diffCounts = (changes: readonly CatalogueChange[]) => ({
  added: changes.filter((c) => c.kind === 'added').length,
  edited: changes.filter((c) => c.kind === 'edited').length,
  retired: changes.filter((c) => c.kind === 'retired').length,
});
