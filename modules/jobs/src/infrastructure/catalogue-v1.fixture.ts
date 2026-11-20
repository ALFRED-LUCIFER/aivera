import type { CatalogueVersion } from '../domain/catalogue.ts';
import snapshot from './catalogue-v1.json' with { type: 'json' };

/** Catalogue version 1 as migration 0012 publishes it (the integration suite proves it), for unit tests. */
export const CATALOGUE_V1 = {
  ...snapshot,
  status: 'published',
  publishedAt: new Date('2026-11-20T00:00:00Z'),
  publishedBy: 'system:seed',
  reason: 'Catalogue version 1 from code (AIV-P1-004, AIV-P1-061)',
} as CatalogueVersion;
