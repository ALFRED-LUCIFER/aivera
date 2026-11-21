'use client';

import { CatalogueEditor, StartDraft } from '@/features/ops/components/CatalogueEditor.tsx';
import { CatalogueEval } from '@/features/ops/components/CatalogueEval.tsx';
import type { DraftModel } from '@/features/ops/domain/catalogueEditor.ts';
import type { EvalView } from '@/features/ops/domain/catalogueEval.ts';
import {
  useCatalogueEditorController,
  useStartDraftController,
} from '@/features/ops/hooks/useCatalogueEditorController.ts';
import { useCatalogueEvalController } from '@/features/ops/hooks/useCatalogueEvalController.ts';

export function CatalogueEditorClient({
  publishedVersion,
  draft,
  evalView,
}: {
  publishedVersion: number;
  draft: DraftModel;
  evalView: EvalView;
}) {
  const editor = useCatalogueEditorController(draft);
  const evalModel = useCatalogueEvalController(draft, evalView);
  return (
    <div className="flex flex-col gap-6">
      <CatalogueEditor publishedVersion={publishedVersion} view={editor} />
      <CatalogueEval eval={evalModel} />
    </div>
  );
}

export function StartDraftClient({ version }: { version: number }) {
  return <StartDraft version={version} {...useStartDraftController()} />;
}
