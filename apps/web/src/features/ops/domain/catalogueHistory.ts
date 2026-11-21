// The catalogue version history at /ops/catalogue/versions (AIV-P2-050, ADR-013 point 13). Pure (ADR-003).
import { HISTORY_PAGE_SIZE, type CatalogueVersionSummary } from '@credalent/jobs';
import { z } from 'zod';

/** A version in the list or the detail, with its publisher's name: null for the seed or an operator no longer known. */
export type VersionRow = CatalogueVersionSummary & { publisherName: string | null };

/** The list's `?page=` (1 when absent); a malformed one is null, so the page is a 404, never a guess. */
export function historyPage(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1;
  const page = z.coerce.number().int().min(1).max(10_000).safeParse(raw);
  return page.success && String(page.data) === raw ? page.data : null;
}

/** A version number from the URL, or null when it is not one. */
export function versionNumber(raw: string): number | null {
  // The column is an int4: a larger number names no version.
  const n = z.coerce.number().int().min(1).max(2_147_483_647).safeParse(raw);
  return n.success && String(n.data) === raw ? n.data : null;
}

export const historyPageCount = (total: number) => Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

/** URLs carry the version or page number only. */
export const versionsHref = (page: number) =>
  page === 1 ? '/ops/catalogue/versions' : `/ops/catalogue/versions?page=${page}`;
export const versionHref = (version: number) => `/ops/catalogue/versions/${version}` as const;
