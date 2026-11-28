import { IntakeError, type SheetImportView } from '@credalent/intake';
import { getIntake } from '@/server/intake';
import { inActiveWorkspace } from '@/server/workspace';
import { sheetImportIdSchema } from '../domain/sheetImport.ts';

/**
 * The member's own sheet import on this job (AIV-P1-103), for the page, or null: a malformed id, another member's or
 * another workspace's import, or one of another job. Intake authorises `candidate.create`.
 */
export async function loadSheetImport(id: unknown, jobId: string): Promise<SheetImportView | null> {
  const parsed = sheetImportIdSchema.safeParse(id);
  if (!parsed.success) return null;
  try {
    const view = (await inActiveWorkspace((ctx) => getIntake().getSheetImport(ctx, parsed.data)))?.value;
    return view?.jobId === jobId ? view : null;
  } catch (error) {
    if (error instanceof IntakeError && error.code === 'sheet_not_found') return null;
    throw error;
  }
}
