'use client';

import type { SheetImportView } from '@credalent/intake';
import { SheetImport, useSheetImportController } from '@/features/sheet-import';

export function SheetImportClient(props: { jobId: string; jobTitle: string; view: SheetImportView | null }) {
  const controller = useSheetImportController(props.jobId, props.view);
  return <SheetImport {...controller} jobTitle={props.jobTitle} />;
}
