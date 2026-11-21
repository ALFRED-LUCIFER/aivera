'use client';

import { CatalogueEditor, StartDraft } from '@/features/ops/components/CatalogueEditor.tsx';
import type { DraftModel } from '@/features/ops/domain/catalogueEditor.ts';
import {
  useCatalogueEditorController,
  useStartDraftController,
} from '@/features/ops/hooks/useCatalogueEditorController.ts';

export function CatalogueEditorClient({ publishedVersion, draft }: { publishedVersion: number; draft: DraftModel }) {
  return <CatalogueEditor publishedVersion={publishedVersion} view={useCatalogueEditorController(draft)} />;
}

export function StartDraftClient({ version }: { version: number }) {
  return <StartDraft version={version} {...useStartDraftController()} />;
}
