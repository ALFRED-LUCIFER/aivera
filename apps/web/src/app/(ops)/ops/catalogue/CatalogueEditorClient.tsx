'use client';

import { CatalogueEditor, StartDraft } from '@/features/ops/components/CatalogueEditor.tsx';
import { CatalogueEval } from '@/features/ops/components/CatalogueEval.tsx';
import { CataloguePublish } from '@/features/ops/components/CataloguePublish.tsx';
import type { DraftModel } from '@/features/ops/domain/catalogueEditor.ts';
import type { EvalView } from '@/features/ops/domain/catalogueEval.ts';
import {
  useCatalogueEditorController,
  useStartDraftController,
} from '@/features/ops/hooks/useCatalogueEditorController.ts';
import { useCatalogueEvalController } from '@/features/ops/hooks/useCatalogueEvalController.ts';
import { useCataloguePublishController } from '@/features/ops/hooks/useCataloguePublishController.ts';

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
  const publish = useCataloguePublishController(draft, publishedVersion, evalView);
  return (
    <div className="flex flex-col gap-6">
      <CatalogueEditor
        publishedVersion={publishedVersion}
        view={editor}
        actions={<CataloguePublish model={publish} />}
      />
      <CatalogueEval eval={evalModel} />
    </div>
  );
}

export function StartDraftClient({ version }: { version: number }) {
  return <StartDraft version={version} {...useStartDraftController()} />;
}
