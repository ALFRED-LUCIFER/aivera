import type { SheetField, SheetImportView, SheetMapping, SheetStatus } from '@credalent/intake';
import { z } from 'zod';

// Importing candidates from a CSV or Excel file (AIV-P1-103). The file is read on the worker, never in the browser;
// the page shows its header row, the proposed mapping and the check before adding, all from the server.

export type { SheetField, SheetImportView, SheetMapping };

/** The fields in the order the mapping step shows them; Name and Email are required. */
export const FIELDS = [
  { field: 'name', required: true },
  { field: 'email', required: true },
  { field: 'cvLink', required: false },
  { field: 'phone', required: false },
] as const satisfies readonly { field: SheetField; required: boolean }[];

/** While the worker reads the file or fetches its CV links, the page reloads every POLL_MS. */
export const POLL_MS = 1500;
export const isWaiting = (status: SheetStatus | undefined) => status === 'reading' || status === 'fetching';

const id = z.uuid();
const column = z.number().int().min(0);

/** The server actions' inputs, validated again on the server (AGENTS.md 3.7). Never the workspace: the session's. */
export const startSheetImportSchema = z.strictObject({ jobId: id, fileId: id });
export const confirmMappingSchema = z.strictObject({
  sheetImportId: id,
  mapping: z.strictObject({ name: column, email: column, cvLink: column.nullable(), phone: column.nullable() }),
});
export const addSheetImportSchema = z.strictObject({
  sheetImportId: id,
  /** The recruiter's tick: responsible for the right to process these CVs for this job (AIV-P1-104). */
  rightToProcessConfirmed: z.literal(true),
});
export const sheetImportIdSchema = id;

/** A refusal the page explains; `failed` is anything else, with nothing changed. */
export type SheetActionError =
  'notAccepted' | 'jobNotFound' | 'invalidMapping' | 'notReady' | 'confirmationRequired' | 'failed';
export type SheetActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: SheetActionError };

/** The mapping the recruiter submits, once Name and Email have a column; null until then. */
export const completeMapping = (mapping: SheetImportView['mapping']): SheetMapping | null =>
  mapping.name === null || mapping.email === null
    ? null
    : { name: mapping.name, email: mapping.email, cvLink: mapping.cvLink, phone: mapping.phone };

/** The people the check would add: every row with a name and a valid email. */
export const peopleOf = (view: SheetImportView) => view.rows.filter((r) => r.problem === null);
