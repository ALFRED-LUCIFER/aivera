// For unit tests only: catalogue version 1 from its committed snapshot, as the jobs migration 0012 publishes it (the
// integration suite proves the two equal). The app reads the catalogue from the database (server/jobs.ts). Read as a
// data file, not imported: no code crosses from the jobs module into the app (ADR-002).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogueVersion } from '@aivera/jobs';

const SNAPSHOT = join(import.meta.dirname, '../../../../modules/jobs/src/infrastructure/catalogue-v1.json');

export const CATALOGUE_V1 = {
  ...JSON.parse(readFileSync(SNAPSHOT, 'utf8')),
  status: 'published',
  publishedAt: new Date('2026-11-20T00:00:00Z'),
  publishedBy: 'system:seed',
  reason: 'Catalogue version 1 from code (AIV-P1-004, AIV-P1-061)',
} as CatalogueVersion;
