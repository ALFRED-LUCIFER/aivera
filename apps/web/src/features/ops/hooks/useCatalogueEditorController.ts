import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  competencyFormFor,
  newCompetencyForm,
  newPackForm,
  packFormFor,
  toggleJobType,
  type CatalogueSaveResult,
  type CompetencyForm,
  type DraftModel,
  type EditorViewModel,
  type PackForm,
  type Refusal,
} from '../domain/catalogueEditor.ts';
import {
  retireDraftEntryAction,
  saveDraftCompetencyAction,
  saveDraftPackAction,
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
  const [error, setError] = useState<Refusal | null>(null);
  const [pending, setPending] = useState(false);

  const open = (pack: PackForm | null, competency: CompetencyForm | null) => {
    setPackForm(pack);
    setCompetencyForm(competency);
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
    error,
    pending,
    onAddPack: () => open(newPackForm(), null),
    onEditPack: (pack) => open(packFormFor(pack), null),
    onPackChange: (patch) => setPackForm((form) => form && { ...form, ...patch }),
    onAddCompetency: (packKey) => open(null, newCompetencyForm(packKey)),
    onEditCompetency: (packKey, row) => open(null, competencyFormFor(packKey, row)),
    onCompetencyChange: (patch) => setCompetencyForm((form) => form && { ...form, ...patch }),
    onToggleJobType: (list, key) => setCompetencyForm((form) => form && toggleJobType(form, list, key)),
    onSave: () =>
      send(() => {
        if (packForm) {
          const { previousKey, key, label } = packForm;
          return saveDraftPackAction({ version, revision, previousKey, key: key.trim(), label });
        }
        return saveDraftCompetencyAction({ version, revision, ...competencyForm });
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
