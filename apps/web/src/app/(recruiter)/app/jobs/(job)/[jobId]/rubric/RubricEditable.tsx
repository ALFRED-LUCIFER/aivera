'use client';

import type { approvesAs } from '@credalent/jobs';
import { Rubric } from '@/features/rubric/components/Rubric.tsx';
import { RubricDecision } from '@/features/rubric/components/RubricDecision.tsx';
import { RubricPublish } from '@/features/rubric/components/RubricPublish.tsx';
import { approverView, decisionPanel, type PublicationView, type RubricView } from '@/features/rubric/domain/rubric.ts';
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
  /** Sending is on here (OUTBOUND); off in the pilot, where no send or publish button shows (AIV-P1-165). */
  outbound: boolean;
};

/**
 * The rubric with edit mode for admins and recruiters (AIV-P1-013), and the approval panel (AIV-P1-014): an admin or
 * recruiter approves the open version, a draft directly (ADR-014); the job's hiring owner reads and decides the version
 * sent to them. Admins and recruiters also publish the job on the candidate site (AIV-P1-015). Where sending is off,
 * nothing here sends or publishes: the recruiter approves alone (AIV-P1-165).
 */
export function RubricEditable({ jobId, rubric, hiringOwner, canEdit, approver, link, publication, outbound }: Props) {
  const editor = useRubricEditController(jobId, rubric.edit);
  const panel = decisionPanel(rubric, approver, canEdit, hiringOwner !== null);
  const { review, canReturn, withOwner } = panel;
  const canSend = panel.canSend && outbound;
  const decision = useRubricDecisionController(jobId, review);
  const publish = useRubricPublishController(jobId, publication.descriptor);
  const view = approverView(rubric, link);
  return (
    <Rubric
      // An editor keeps reading the version in force, as edit mode does (AIV-P1-013); the hiring owner reads what was sent.
      state={{ status: 'ready', rubric: approver && !canEdit ? view.rubric : rubric }}
      editor={canEdit ? (outbound ? editor : { ...editor, onSend: undefined }) : undefined}
      hiringOwner={hiringOwner}
      aside={
        <>
          {/* One primary button per view: the approval panel steps aside while the admin edits the rubric. */}
          {approver && !editor.editing && (review || decision.status !== 'idle') && (
            <RubricDecision
              review={review}
              decision={decision}
              outdatedLink={view.outdatedLink}
              canReturn={canReturn}
              canSend={canSend}
              withOwner={withOwner}
            />
          )}
          {/* job.publish allows the same roles as rubric.edit; the jobs module checks it again. It steps aside while
              editing too, so the view keeps one primary button. Where sending is off it shows only to unpublish. */}
          {(outbound || publication.published) && canEdit && !editor.editing && (
            <RubricPublish publication={publication} publish={publish} />
          )}
        </>
      }
    />
  );
}
