import type { AuditContract } from '@credalent/audit';
import type { Tx } from '@credalent/db/client';
import { and, eq, sql } from 'drizzle-orm';
import type { DraftStore } from '../application/catalogue-editor.ts';
import { readCatalogueVersion } from './catalogue.ts';
import { cataloguePack, cataloguePackCompetency, catalogueRegionalHint, catalogueVersion } from './schema.ts';

// Columns a draft copies from the published version, parents before children (foreign keys). Constants, not input.
const COPIED: readonly (readonly [string, string])[] = [
  ['catalogue_job_type', 'key, position, label, evidence, starter_competencies, retired'],
  ['catalogue_region', 'key, position, label, retired'],
  ['catalogue_pack', 'key, position, label, retired'],
  [
    'catalogue_pack_competency',
    'pack_key, position, name, meaning, evidence, level_1, level_3, level_5, applies_to, level_needed, type, retired, core',
  ],
  [
    'catalogue_regional_hint',
    'pack_key, region, position, name, meaning, evidence, level_1, level_3, level_5, applies_to, level_needed, type, retired',
  ],
];

// A pack's children: its competencies and regional hints.
const children = [cataloguePackCompetency, catalogueRegionalHint] as const;
const isDraft = eq(catalogueVersion.status, 'draft');
const setEnglish = (label: string) => sql`jsonb_set(${cataloguePack.label}, '{en}', to_jsonb(${label}::text))`;

const competency = (version: number, packKey: string, position: number) =>
  and(
    eq(cataloguePackCompetency.version, version),
    eq(cataloguePackCompetency.packKey, packKey),
    eq(cataloguePackCompetency.position, position),
  );
const pack = (version: number, key: string) => and(eq(cataloguePack.version, version), eq(cataloguePack.key, key));

/** The draft store over one transaction on the app's pool; the platform audit write joins it. */
export function draftStore(tx: Tx, audit: Pick<AuditContract, 'recordPlatform'>): DraftStore {
  return {
    async read() {
      const published = await readCatalogueVersion(tx, eq(catalogueVersion.status, 'published'));
      if (!published) throw new Error('no published catalogue version');
      return { published, draft: await readCatalogueVersion(tx, isDraft) };
    },

    async lockDraft() {
      const [row] = await tx
        .select({
          version: catalogueVersion.version,
          revision: catalogueVersion.revision,
          revisedBy: catalogueVersion.revisedBy,
        })
        .from(catalogueVersion)
        .where(isDraft)
        .for('update');
      return row ?? null;
    },

    async createDraft(from, to, operatorId, createdAt) {
      await tx.insert(catalogueVersion).values({ version: to, status: 'draft', createdBy: operatorId, createdAt });
      for (const [table, columns] of COPIED) {
        const name = sql`${sql.identifier('jobs')}.${sql.identifier(table)}`;
        await tx.execute(
          sql`insert into ${name} (version, ${sql.raw(columns)}) select ${to}, ${sql.raw(columns)} from ${name} where version = ${from}`,
        );
      }
    },

    async touch(version, operatorId) {
      await tx
        .update(catalogueVersion)
        .set({ revision: sql`${catalogueVersion.revision} + 1`, revisedBy: operatorId })
        .where(and(eq(catalogueVersion.version, version), isDraft));
    },

    async putPack(version, previousKey, { key, label }) {
      if (previousKey === null) {
        await tx.insert(cataloguePack).values({
          version,
          key,
          label: { en: label },
          position: sql`(select coalesce(max(position), -1) + 1 from jobs.catalogue_pack where version = ${version})`,
        });
        return;
      }
      if (previousKey === key) {
        await tx
          .update(cataloguePack)
          .set({ label: setEnglish(label) })
          .where(pack(version, key));
        return;
      }
      // A new pack's key changes: the row under the new key first, its entries moved to it, then the old row goes.
      await tx.execute(sql`insert into jobs.catalogue_pack (version, key, position, label, retired)
        select version, ${key}, position, jsonb_set(label, '{en}', to_jsonb(${label}::text)), retired
        from jobs.catalogue_pack where version = ${version} and key = ${previousKey}`);
      for (const table of children)
        await tx
          .update(table)
          .set({ packKey: key })
          .where(and(eq(table.version, version), eq(table.packKey, previousKey)));
      await tx.delete(cataloguePack).where(pack(version, previousKey));
    },

    async putCompetency(version, { packKey, position, levels, ...fields }) {
      const values = { ...fields, level1: levels[1], level3: levels[3], level5: levels[5] };
      if (position !== null) {
        await tx
          .update(cataloguePackCompetency)
          .set(values)
          .where(competency(version, packKey, position));
        return position;
      }
      const [row] = await tx
        .insert(cataloguePackCompetency)
        .values({
          ...values,
          version,
          packKey,
          type: 'desirable',
          position: sql`(select coalesce(max(position), -1) + 1 from jobs.catalogue_pack_competency
            where version = ${version} and pack_key = ${packKey})`,
        })
        .returning({ position: cataloguePackCompetency.position });
      if (!row) throw new Error('competency not inserted');
      return row.position;
    },

    async retire(version, packKey, position) {
      await (position === undefined
        ? tx.update(cataloguePack).set({ retired: true }).where(pack(version, packKey))
        : tx
            .update(cataloguePackCompetency)
            .set({ retired: true })
            .where(competency(version, packKey, position)));
    },

    async remove(version, packKey, position) {
      if (position !== undefined) {
        await tx.delete(cataloguePackCompetency).where(competency(version, packKey, position));
        return;
      }
      for (const table of children)
        await tx.delete(table).where(and(eq(table.version, version), eq(table.packKey, packKey)));
      await tx.delete(cataloguePack).where(pack(version, packKey));
    },

    recordPlatform: (entry) => audit.recordPlatform(entry, tx),
  };
}
