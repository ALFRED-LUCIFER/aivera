'use client';

import { Rubric } from '@/features/rubric/components/Rubric.tsx';
import type { RubricView } from '@/features/rubric/domain/rubric.ts';
import { useRubricEditController } from '@/features/rubric/hooks/useRubricEditController.ts';

type Props = { jobId: string; rubric: RubricView; hiringOwner: string | null };

/** The rubric with edit mode, for admins and recruiters (AIV-P1-013). */
export function RubricEditable({ jobId, rubric, hiringOwner }: Props) {
  const editor = useRubricEditController(jobId, rubric.edit);
  return <Rubric state={{ status: 'ready', rubric }} editor={editor} hiringOwner={hiringOwner} />;
}
