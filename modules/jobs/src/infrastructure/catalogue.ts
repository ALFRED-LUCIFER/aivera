import type { Tx } from '@credalent/db/client';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { CatalogueVersion } from '../domain/catalogue.ts';
import type { CatalogueDraft } from '../domain/catalogue-draft.ts';
import {
  catalogueJobType,
  cataloguePack,
  cataloguePackCompetency,
  catalogueRegion,
  catalogueRegionalHint,
  catalogueVersion,
} from './schema.ts';

type SkillRow = typeof catalogueRegionalHint.$inferSelect | typeof cataloguePackCompetency.$inferSelect;
const skill = ({
  name,
  meaning,
  evidence,
  level1,
  level3,
  level5,
  appliesTo,
  levelNeeded,
  type,
  retired,
}: SkillRow) => ({
  name,
  meaning,
  evidence,
  levels: { 1: level1, 3: level3, 5: level5 },
  appliesTo,
  levelNeeded,
  type,
  retired,
});

/**
 * The newest version matching `where`, with every entry, retired ones flagged, in catalogue order, competencies with
 * their positions, and the version's revision; null when none.
 * `tx` is one repeatable-read snapshot (composition.ts): a draft may be saved or discarded meanwhile.
 */
export async function readCatalogueVersion(tx: Tx, where: SQL): Promise<CatalogueDraft | null> {
  const [header] = await tx
    .select()
    .from(catalogueVersion)
    .where(where)
    .orderBy(desc(catalogueVersion.version))
    .limit(1);
  if (!header) return null;
  const { version } = header;
  const jobTypes = await tx
    .select()
    .from(catalogueJobType)
    .where(eq(catalogueJobType.version, version))
    .orderBy(catalogueJobType.position);
  const regions = await tx
    .select()
    .from(catalogueRegion)
    .where(eq(catalogueRegion.version, version))
    .orderBy(catalogueRegion.position);
  const packs = await tx
    .select()
    .from(cataloguePack)
    .where(eq(cataloguePack.version, version))
    .orderBy(cataloguePack.position);
  const competencies = await tx
    .select()
    .from(cataloguePackCompetency)
    .where(eq(cataloguePackCompetency.version, version))
    .orderBy(cataloguePackCompetency.position);
  const hints = await tx
    .select({ hint: catalogueRegionalHint })
    .from(catalogueRegionalHint)
    .innerJoin(
      catalogueRegion,
      and(eq(catalogueRegion.version, version), eq(catalogueRegion.key, catalogueRegionalHint.region)),
    )
    .where(eq(catalogueRegionalHint.version, version))
    .orderBy(catalogueRegion.position, catalogueRegionalHint.position);
  return {
    version,
    status: header.status,
    publishedAt: header.publishedAt,
    publishedBy: header.publishedBy,
    reason: header.reason,
    revision: header.revision,
    revisedBy: header.revisedBy,
    jobTypes: jobTypes.map(({ key, label, evidence, starterCompetencies, retired }) => ({
      key,
      label,
      evidence,
      starterCompetencies,
      retired,
    })),
    regions: regions.map(({ key, label, retired }) => ({ key, label, retired })),
    packs: packs.map(({ key, label, retired }) => ({
      key,
      label,
      retired,
      competencies: competencies
        .filter((c) => c.packKey === key)
        .map((c) => ({ ...skill(c), core: c.core, position: c.position })),
      hints: hints
        .map((r) => r.hint)
        .filter((h) => h.packKey === key)
        .map((h) => ({ ...skill(h), region: h.region })),
    })),
  };
}

/** The latest published version; throws when there is none, since migration 0012 always seeds version 1. */
export async function readPublishedCatalogue(tx: Tx): Promise<CatalogueVersion> {
  const catalogue = await readCatalogueVersion(tx, eq(catalogueVersion.status, 'published'));
  if (!catalogue) throw new Error('no published catalogue version');
  // Readers outside the editor get the entries only: no revision, no positions.
  const { revision: _revision, revisedBy: _revisedBy, ...published } = catalogue;
  return {
    ...published,
    packs: published.packs.map((p) => ({ ...p, competencies: p.competencies.map(({ position: _p, ...c }) => c) })),
  };
}
