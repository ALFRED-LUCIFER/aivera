import type { Tx } from '@credalent/db';
import type { Action, JobResource, WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import { IntakeError } from '../domain/application.ts';
import {
  isValidMapping,
  MAX_SHEET_ROWS,
  proposeMapping,
  readRows,
  type SheetField,
  type SheetMapping,
  type SheetRow,
  type SheetStatus,
  type SheetUnreadable,
} from '../domain/sheet.ts';
import type { ReceiveBatchInput } from './applications.ts';

/** A sheet import as stored (AIV-P1-103). `headers` and `rows` hold the sheet's values: never log them. */
export type SheetImport = {
  id: string;
  workspaceId: string;
  jobId: string;
  /** The clean `candidate_sheet` upload. */
  fileId: string;
  /** The member who uploaded it; only they see it, and its fetched CVs are filed as their uploads. */
  createdBy: string;
  createdAt: Date;
  status: SheetStatus;
  problem: SheetUnreadable | null;
  headers: string[] | null;
  mapping: SheetMapping | null;
  rows: SheetRow[] | null;
};

type Change = Pick<SheetImport, 'status'> & Partial<Pick<SheetImport, 'problem' | 'headers' | 'mapping' | 'rows'>>;

export type SheetStore = {
  insert(sheet: SheetImport): Promise<void>;
  find(workspaceId: string, id: string): Promise<SheetImport | null>;
  /** Applies `change` only while the status is still `from`, so a step runs once however often it is asked for. */
  move(workspaceId: string, id: string, from: SheetStatus, change: Change): Promise<boolean>;
};

export type SheetPorts = {
  sheetStoreFor(tx: Tx): SheetStore;
  /** Writes `SheetImportRequested.v1` to the outbox in `tx`: the worker reads the sheet or fetches its CVs. */
  publishSheetStep(tx: Tx, sheet: SheetImport): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  jobResource(ctx: WorkspaceContext, jobId: string): Promise<JobResource | null>;
  /** Intake's own `receiveBatch`: one confirmation, audited last. */
  receiveBatch(ctx: WorkspaceContext, input: ReceiveBatchInput): Promise<{ batchId: string }>;
  isSyntheticWorkspace(ctx: WorkspaceContext): Promise<boolean>;
  newId(): string;
  now(): Date;
};

/** What the worker step reads and fetches, wired by the worker from the files module. */
export type SheetWorkerPorts = {
  sheetStoreFor(tx: Tx): SheetStore;
  /** The sheet's cells, row by row, as text; `unreadable` when it is not a clean, readable CSV or Excel file. */
  readSheet(tx: Tx, workspaceId: string, fileId: string): Promise<string[][] | 'unreadable'>;
  /** The CV link fetched behind the SSRF guard and stored as `uploadedBy`'s pending `cv` file; null when it could not be. */
  fetchCv(workspaceId: string, uploadedBy: string, url: string): Promise<string | null>;
};

/** One row of the check before adding: a person (with what became of their CV link) or a row number and its problem. */
export type SheetRowView =
  | { row: number; problem: 'missing_name' | 'missing_email' | 'invalid_email' }
  | { row: number; problem: null; name: string; email: string; cv: 'attached' | 'unreadable' | 'none' };

export type SheetImportView = {
  id: string;
  jobId: string;
  status: SheetStatus;
  problem: SheetUnreadable | null;
  headers: string[];
  /** The confirmed mapping, or until then the one Credalent proposes from the header row. */
  mapping: Record<SheetField, number | null>;
  rows: SheetRowView[];
};

const column = z.number().int().min(0);
const mappingSchema = z.strictObject({
  name: column,
  email: column,
  cvLink: column.nullable(),
  phone: column.nullable(),
});

// shortcut: CV links are fetched eight at a time in the worker's one transaction, so 1,000 links at the 10 s timeout
// take up to about 21 minutes, past the message lock's 5 minutes of renewal (a redelivery then waits on the inbox row
// and is skipped); queue one fetch per row if pilot sheets have hundreds of slow links.
const FETCHES_AT_ONCE = 8;

export function sheetImportUseCases(p: SheetPorts) {
  /** The member's own import, or `sheet_not_found`: another member's import reads as missing. */
  async function own(ctx: WorkspaceContext, id: string): Promise<SheetImport> {
    await p.authorize(ctx, 'candidate.create');
    const sheet = await p.sheetStoreFor(ctx.tx).find(ctx.workspaceId, id);
    if (sheet?.createdBy !== ctx.userId) throw new IntakeError('sheet_not_found');
    return sheet;
  }

  return {
    /** The member's clean sheet upload, for the job: the worker reads its header row next. */
    async startSheetImport(ctx: WorkspaceContext, input: { jobId: string; fileId: string }) {
      await p.authorize(ctx, 'candidate.create');
      if (!(await p.jobResource(ctx, input.jobId))) throw new IntakeError('job_not_found');
      const sheet: SheetImport = {
        id: p.newId(),
        workspaceId: ctx.workspaceId,
        jobId: input.jobId,
        fileId: input.fileId,
        createdBy: ctx.userId,
        createdAt: p.now(),
        status: 'reading',
        problem: null,
        headers: null,
        mapping: null,
        rows: null,
      };
      await p.sheetStoreFor(ctx.tx).insert(sheet);
      await p.publishSheetStep(ctx.tx, sheet);
      return { sheetImportId: sheet.id };
    },

    async getSheetImport(ctx: WorkspaceContext, id: string): Promise<SheetImportView> {
      const sheet = await own(ctx, id);
      const headers = sheet.headers ?? [];
      return {
        id: sheet.id,
        jobId: sheet.jobId,
        status: sheet.status,
        problem: sheet.problem,
        headers,
        mapping: sheet.mapping ?? proposeMapping(headers),
        rows: (sheet.rows ?? []).map((r) =>
          r.problem === null
            ? {
                row: r.row,
                problem: null,
                name: r.name,
                email: r.email,
                cv: typeof r.cv === 'object' ? 'attached' : r.cv,
              }
            : { row: r.row, problem: r.problem },
        ),
      };
    },

    /** The recruiter's mapping: the worker reads the rows under it and fetches their CV links. Nobody is added yet. */
    async confirmSheetMapping(ctx: WorkspaceContext, input: { sheetImportId: string; mapping: SheetMapping }) {
      const sheet = await own(ctx, input.sheetImportId);
      if (sheet.status !== 'mapping') throw new IntakeError('sheet_not_ready');
      const mapping = mappingSchema.safeParse(input.mapping);
      if (!mapping.success || !isValidMapping(mapping.data, sheet.headers?.length ?? 0))
        throw new IntakeError('invalid_mapping');
      const change = { status: 'fetching', mapping: mapping.data } as const;
      if (!(await p.sheetStoreFor(ctx.tx).move(ctx.workspaceId, sheet.id, 'mapping', change)))
        throw new IntakeError('sheet_not_ready');
      await p.publishSheetStep(ctx.tx, { ...sheet, ...change });
    },

    /**
     * "Add N people to this job": every row with a name and a valid email becomes an application with source
     * `spreadsheet`, under one batch and its confirmation, audited last (AIV-P1-104). A row whose CV was fetched brings
     * it; the evidence pipeline waits for its scan as for an upload. Throws `sheet_not_ready` unless the check is
     * ready and has someone to add, and intake's `confirmation_required` without the tick.
     */
    async addSheetImport(
      ctx: WorkspaceContext,
      input: { sheetImportId: string; rightToProcessConfirmed: true; wordingKey: string },
    ) {
      const sheet = await own(ctx, input.sheetImportId);
      const people = (sheet.rows ?? []).filter((r) => r.problem === null);
      if (sheet.status !== 'ready' || people.length === 0) throw new IntakeError('sheet_not_ready');
      // Moved first, so a second confirm (another tab) adds nobody twice; a refused batch rolls this back too.
      if (!(await p.sheetStoreFor(ctx.tx).move(ctx.workspaceId, sheet.id, 'ready', { status: 'added' })))
        throw new IntakeError('sheet_not_ready');
      const synthetic = await p.isSyntheticWorkspace(ctx);
      return p.receiveBatch(ctx, {
        jobId: sheet.jobId,
        rightToProcessConfirmed: input.rightToProcessConfirmed,
        wordingKey: input.wordingKey,
        arrivals: people.map((r) => ({
          person: {
            displayName: r.name,
            identifiers: [
              { type: 'email' as const, value: r.email },
              ...(r.phone ? [{ type: 'phone' as const, value: r.phone }] : []),
            ],
            synthetic,
          },
          source: 'spreadsheet' as const,
          fileIds: typeof r.cv === 'object' ? [r.cv.fileId] : [],
        })),
      });
    },
  };
}

/**
 * The worker's step for `SheetImportRequested.v1`, in the event's workspace transaction: `reading` stores the header
 * row; `fetching` reads the rows under the mapping and fetches each CV link. Any other status was already handled, so
 * a redelivery changes nothing. No sheet value is logged or thrown: an unreadable file is a status.
 */
export async function advanceSheetImport(p: SheetWorkerPorts, tx: Tx, workspaceId: string, id: string) {
  const store = p.sheetStoreFor(tx);
  const sheet = await store.find(workspaceId, id);
  if (sheet?.status !== 'reading' && sheet?.status !== 'fetching') return;
  const cells = await p.readSheet(tx, workspaceId, sheet.fileId);
  const problem: SheetUnreadable | null =
    cells === 'unreadable' || !cells[0]?.some((h) => h.trim())
      ? 'unreadable'
      : cells.length - 1 > MAX_SHEET_ROWS
        ? 'too_many_rows'
        : null;
  if (problem || cells === 'unreadable') {
    await store.move(workspaceId, id, sheet.status, { status: 'unreadable', problem: problem ?? 'unreadable' });
    return;
  }
  if (sheet.status === 'reading') {
    await store.move(workspaceId, id, 'reading', { status: 'mapping', headers: (cells[0] ?? []).map((h) => h.trim()) });
    return;
  }
  if (!sheet.mapping) throw new Error('a sheet import is fetching without a mapping');
  const { rows, links } = readRows(cells, sheet.mapping);
  const pending = [...links];
  const fetched = new Map<number, string | null>();
  await Promise.all(
    Array.from({ length: FETCHES_AT_ONCE }, async () => {
      for (let next = pending.shift(); next; next = pending.shift()) {
        const [row, url] = next;
        fetched.set(row, await p.fetchCv(workspaceId, sheet.createdBy, url));
      }
    }),
  );
  const withCvs = rows.map((r): SheetRow => {
    if (r.problem !== null || !fetched.has(r.row)) return r;
    const fileId = fetched.get(r.row);
    return { ...r, cv: fileId ? { fileId } : 'unreadable' };
  });
  await store.move(workspaceId, id, 'fetching', { status: 'ready', rows: withCvs });
}
