// The catalogue draft's content hash (AIV-P2-048, ADR-013 point 12). Apart from catalogue-eval.ts because it needs
// node:crypto, and the contracts (which browser code imports) must not.
import { createHash } from 'node:crypto';
import type { CatalogueVersion } from './catalogue.ts';

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;

/**
 * SHA-256 of the draft's entries with object keys in a canonical order, so field order never changes it and any entry
 * change does. Version, revision and who saved are not content.
 */
export const contentHash = ({ jobTypes, regions, packs }: Pick<CatalogueVersion, 'jobTypes' | 'regions' | 'packs'>) =>
  createHash('sha256')
    .update(JSON.stringify(canonical({ jobTypes, regions, packs })))
    .digest('hex');
