'use server';

import { CatalogueError } from '@credalent/jobs';
import { log } from '@credalent/observability';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import {
  openCatalogueDraft,
  operatorName,
  platformOperator,
  retireCatalogueEntry,
  saveCatalogueCompetency,
  saveCataloguePack,
} from '@/server/operator';
import {
  draftCompetencySchema,
  draftPackSchema,
  invalidResult,
  retireEntrySchema,
  type CatalogueSaveResult,
} from '../domain/catalogueEditor.ts';

// The catalogue draft's server actions (AIV-P2-045). Operators only: anyone else gets a 403 and the draft is unchanged.
// Input is parsed here against the jobs module's schemas (and again by the module); a refusal comes back as a value, so
// the form can show it under its field. Nothing a recruiter sees changes until publish (AIV-P2-049).

async function attempt(write: () => Promise<unknown>): Promise<CatalogueSaveResult> {
  try {
    await write();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CatalogueError)
      return {
        ok: false,
        error: error.code,
        ...(error.field && { field: error.field }),
        ...(error.code === 'stale' && { by: error.by && (await operatorName(error.by)) }),
      };
    // The name only: a database error can quote the refused text (AGENTS.md 1.2).
    log.error({ area: 'ops', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'catalogue save failed');
    return { ok: false, error: 'failed' };
  }
  revalidatePath('/ops/catalogue');
  return { ok: true };
}

/** "Start a draft": a copy of the latest published version. */
export async function startCatalogueDraft(): Promise<CatalogueSaveResult> {
  await platformOperator();
  return attempt(openCatalogueDraft);
}

/** Adds a pack, or edits its label (and its key while it is new in the draft). */
export async function saveDraftPackAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = draftPackSchema.safeParse(input);
  return parsed.success ? attempt(() => saveCataloguePack(parsed.data)) : invalidResult(parsed.error);
}

/** Adds or edits a competency, after the fairness check and the core limit. */
export async function saveDraftCompetencyAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = draftCompetencySchema.safeParse(input);
  return parsed.success ? attempt(() => saveCatalogueCompetency(parsed.data)) : invalidResult(parsed.error);
}

/** Retires a published pack or competency, or removes one new in the draft. */
export async function retireDraftEntryAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = retireEntrySchema.safeParse(input);
  return parsed.success ? attempt(() => retireCatalogueEntry(parsed.data)) : { ok: false, error: 'failed' };
}
