'use server';

import { CatalogueError } from '@credalent/jobs';
import { log } from '@credalent/observability';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import {
  discardCatalogueDraft,
  openCatalogueDraft,
  operatorName,
  platformOperator,
  publishCatalogueDraft,
  requestCatalogueEval,
  retireCatalogueEntry,
  saveCatalogueCompetency,
  saveCatalogueHint,
  saveCatalogueJobType,
  saveCataloguePack,
  saveCatalogueRegion,
} from '@/server/operator';
import {
  discardDraftSchema,
  draftCompetencySchema,
  draftHintSchema,
  draftJobTypeSchema,
  draftPackSchema,
  draftRegionSchema,
  invalidResult,
  publishDraftSchema,
  retireEntrySchema,
  type CatalogueSaveResult,
} from '../domain/catalogueEditor.ts';
import { evalRequestSchema } from '../domain/catalogueEval.ts';

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

/** Adds or edits a regional hint (AIV-P2-046), after the residency and fairness checks; never mandatory. */
export async function saveDraftHintAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = draftHintSchema.safeParse(input);
  return parsed.success ? attempt(() => saveCatalogueHint(parsed.data)) : invalidResult(parsed.error);
}

/** Adds a region, or edits its label (and its key while it is new in the draft) (AIV-P2-059). */
export async function saveDraftRegionAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = draftRegionSchema.safeParse(input);
  return parsed.success ? attempt(() => saveCatalogueRegion(parsed.data)) : invalidResult(parsed.error);
}

/** Adds a job type, or edits its texts, starters and place in the Add a job list (AIV-P2-047). */
export async function saveDraftJobTypeAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = draftJobTypeSchema.safeParse(input);
  return parsed.success ? attempt(() => saveCatalogueJobType(parsed.data)) : invalidResult(parsed.error);
}

/** Retires a published pack, competency, job type, region or regional hint, or removes one new in the draft. */
export async function retireDraftEntryAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = retireEntrySchema.safeParse(input);
  return parsed.success ? attempt(() => retireCatalogueEntry(parsed.data)) : { ok: false, error: 'failed' };
}

/** "Run the eval" on the draft as the page showed it (AIV-P2-048): queues a worker run; one at a time per draft. */
export async function runCatalogueEvalAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = evalRequestSchema.safeParse(input);
  return parsed.success ? attempt(() => requestCatalogueEval(parsed.data)) : { ok: false, error: 'failed' };
}

/**
 * "Publish version N" (AIV-P2-049) with the operator's reason. The eval gate and the change check run again in the
 * module, on the locked draft: what the page showed is never trusted. Every page is dynamic (the root layout reads the
 * theme cookie), so recruiters' pages read the new version on their next request.
 */
export async function publishCatalogueAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = publishDraftSchema.safeParse(input);
  return parsed.success ? attempt(() => publishCatalogueDraft(parsed.data)) : invalidResult(parsed.error);
}

/** "Discard draft" (AIV-P2-049): deletes the draft as the page showed it; recruiters keep the published version. */
export async function discardCatalogueAction(input: unknown): Promise<CatalogueSaveResult> {
  await platformOperator();
  const parsed = discardDraftSchema.safeParse(input);
  return parsed.success ? attempt(() => discardCatalogueDraft(parsed.data)) : { ok: false, error: 'failed' };
}
