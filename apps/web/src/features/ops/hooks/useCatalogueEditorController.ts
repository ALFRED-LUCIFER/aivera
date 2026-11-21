import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  competencyFormFor,
  jobTypeFormFor,
  jobTypeInput,
  newCompetencyForm,
  newJobTypeForm,
  newPackForm,
  packFormFor,
  toggleJobType,
  type CatalogueSaveResult,
  type CompetencyForm,
  type DraftModel,
  type EditorViewModel,
  type JobTypeForm,
  type PackForm,
  type Refusal,
} from '../domain/catalogueEditor.ts';
import {
  retireDraftEntryAction,
  saveDraftCompetencyAction,
  saveDraftHintAction,
  saveDraftJobTypeAction,
  saveDraftPackAction,
  saveDraftRegionAction,
  startCatalogueDraft,
} from '../services/editCatalogue.ts';

/**
 * Editing the catalogue draft (AIV-P2-045): each save sends the draft's version and the revision the page was loaded
 * with, so a save after another operator's is refused, never overwrites; after a save the page reloads the draft.
 */
export function useCatalogueEditorController(draft: DraftModel): EditorViewModel {
  const router = useRouter();
  const [packForm, setPackForm] = useState<PackForm | null>(null);
  const [competencyForm, setCompetencyForm] = useState<CompetencyForm | null>(null);
  const [jobTypeForm, setJobTypeForm] = useState<JobTypeForm | null>(null);
  const [error, setError] = useState<Refusal | null>(null);
  const [pending, setPending] = useState(false);

  const open = (pack: PackForm | null, competency: CompetencyForm | null, jobType: JobTypeForm | null = null) => {
    setPackForm(pack);
    setCompetencyForm(competency);
    setJobTypeForm(jobType);
    setError(null);
  };
  const send = async (save: () => Promise<CatalogueSaveResult>) => {
    setPending(true);
    try {
      const result = await save();
      if (result.ok) {
        open(null, null);
        router.refresh();
      } else setError(result);
    } catch {
      setError({ ok: false, error: 'failed' });
    } finally {
      setPending(false);
    }
  };
  const { version, revision } = draft;

  return {
    draft,
    packForm,
    competencyForm,
    jobTypeForm,
    error,
    pending,
    onAddPack: () => open(newPackForm(), null),
    onEditPack: (pack) => open(packFormFor(pack), null),
    onPackChange: (patch) => setPackForm((form) => form && { ...form, ...patch }),
    onAddRegion: () => open(newPackForm('region'), null),
    onEditRegion: (row) => open(packFormFor(row, 'region'), null),
    onRetireRegion: (region) => send(() => retireDraftEntryAction({ version, revision, entry: 'region', region })),
    onAddCompetency: (packKey) => open(null, newCompetencyForm(packKey)),
    onEditCompetency: (packKey, row) => open(null, competencyFormFor(packKey, row)),
    onAddHint: (packKey, region) => open(null, newCompetencyForm(packKey, region)),
    onEditHint: (packKey, row) => open(null, competencyFormFor(packKey, row)),
    onCompetencyChange: (patch) => setCompetencyForm((form) => form && { ...form, ...patch }),
    onToggleJobType: (list, key) => setCompetencyForm((form) => form && toggleJobType(form, list, key)),
    onAddJobType: () => open(null, null, newJobTypeForm(draft)),
    onEditJobType: (row) => open(null, null, jobTypeFormFor(draft, row)),
    onJobTypeChange: (patch) => setJobTypeForm((form) => form && { ...form, ...patch }),
    onRetireJobType: (jobTypeKey) =>
      send(() => retireDraftEntryAction({ version, revision, entry: 'jobType', jobTypeKey })),
    onSave: () =>
      send(() => {
        if (jobTypeForm) return saveDraftJobTypeAction(jobTypeInput(draft, jobTypeForm));
        if (packForm) {
          const { entry, previousKey, key, label } = packForm;
          const save = entry === 'region' ? saveDraftRegionAction : saveDraftPackAction;
          return save({ version, revision, previousKey, key: key.trim(), label });
        }
        if (!competencyForm) return Promise.resolve<CatalogueSaveResult>({ ok: false, error: 'failed' });
        const { region, core, ...fields } = competencyForm;
        return region === null
          ? saveDraftCompetencyAction({ version, revision, ...fields, core })
          : saveDraftHintAction({ version, revision, ...fields, region });
      }),
    onClose: () => open(null, null),
    onReload: () => {
      open(null, null);
      router.refresh();
    },
    onRetire: (packKey, position) =>
      send(() =>
        retireDraftEntryAction(
          position === undefined
            ? { version, revision, entry: 'pack', packKey }
            : { version, revision, entry: 'competency', packKey, position },
        ),
      ),
    onRetireHint: (packKey, { region, position }) =>
      send(() => retireDraftEntryAction({ version, revision, entry: 'regionalHint', packKey, region, position })),
  };
}

/** "Start a draft" (AIV-P2-045): a copy of the published version, then the page shows the editor. */
export function useStartDraftController() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<Refusal | null>(null);
  return {
    pending,
    error: failed,
    onStart: async () => {
      setPending(true);
      const result = await startCatalogueDraft().catch((): CatalogueSaveResult => ({ ok: false, error: 'failed' }));
      setPending(false);
      if (result.ok) router.refresh();
      else setFailed(result);
    },
  };
}
