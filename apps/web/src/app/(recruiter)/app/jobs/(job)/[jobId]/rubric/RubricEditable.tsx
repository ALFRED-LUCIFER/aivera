'use client';

import type { approvesAs } from '@aivera/jobs';
import { Rubric } from '@/features/rubric/components/Rubric.tsx';
import { RubricDecision } from '@/features/rubric/components/RubricDecision.tsx';
import { RubricPublish } from '@/features/rubric/components/RubricPublish.tsx';
import { approverView, type PublicationView, type RubricView } from '@/features/rubric/domain/rubric.ts';
import { useRubricDecisionController } from '@/features/rubric/hooks/useRubricDecisionController.ts';
import { useRubricEditController } from '@/features/rubric/hooks/useRubricEditController.ts';
import { useRubricPublishController } from '@/features/rubric/hooks/useRubricPublishController.ts';

type Props = {
  jobId: string;
  rubric: RubricView;
  hiringOwner: string | null;
  canEdit: boolean;
  approver: ReturnType<typeof approvesAs>;
  link: { versionId: string; revision: number } | null;
  publication: PublicationView;
};

/**
 * The rubric with edit mode for admins and recruiters (AIV-P1-013), and the approval panel for the job's hiring owner
 * or an admin acting as owner (AIV-P1-014); the hiring owner reads the version awaiting approval. Admins and recruiters
 * also publish the job on the candidate site (AIV-P1-015).
 */
export function RubricEditable({ jobId, rubric, hiringOwner, canEdit, approver, link, publication }: Props) {
  const editor = useRubricEditController(jobId, rubric.edit);
  const decision = useRubricDecisionController(jobId, rubric.review);
  const publish = useRubricPublishController(jobId, publication.descriptor);
  const view = approverView(rubric, link);
  return (
    <Rubric
      // An editor (an admin acting as owner) keeps reading the version in force, as edit mode does (AIV-P1-013).
      state={{ status: 'ready', rubric: approver && !canEdit ? view.rubric : rubric }}
      editor={canEdit ? editor : undefined}
      hiringOwner={hiringOwner}
      aside={
        <>
          {/* One primary button per view: the approval panel steps aside while the admin edits the rubric. */}
          {approver && !editor.editing && (rubric.review || decision.status !== 'idle') && (
            <RubricDecision
              review={rubric.review}
              decision={decision}
              outdatedLink={view.outdatedLink}
              actingAsAdmin={approver === 'admin_as_owner'}
            />
          )}
          {/* job.publish allows the same roles as rubric.edit; the jobs module checks it again. It steps aside while
              editing too, so the view keeps one primary button. */}
          {canEdit && !editor.editing && <RubricPublish publication={publication} publish={publish} />}
        </>
      }
    />
  );
}
