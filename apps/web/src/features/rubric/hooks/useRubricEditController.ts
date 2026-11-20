import type { Competency } from '@credalent/jobs';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { canSave, newCompetency, weightsTotal, type RubricEditorView, type RubricView } from '../domain/rubric.ts';
import { saveRubricDraft } from '../services/saveRubricDraft.ts';

/**
 * Edit mode of the rubric page (AIV-P1-013): a local copy of the open version (or the approved one), saved as the draft
 * or saved and sent for approval. Nothing changes on the server until the recruiter saves.
 */
export function useRubricEditController(jobId: string, edit: RubricView['edit']): RubricEditorView {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [successStatement, setSuccessStatement] = useState('');
  const [base, setBase] = useState(edit?.base);
  const [status, setStatus] = useState<RubricEditorView['status']>('idle');
  const [pending, startTransition] = useTransition();

  const change = (index: number, patch: Partial<Competency>) => {
    setCompetencies((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setStatus('idle');
  };

  const save = (submit: boolean) =>
    startTransition(async () => {
      if (!base) return;
      const result = await saveRubricDraft({ jobId, base, successStatement, competencies, submit });
      if ('error' in result) return setStatus(result.error);
      setBase(result.base);
      setStatus(submit ? 'sent' : 'saved');
      if (submit) setEditing(false);
      router.refresh();
    });

  return {
    editing,
    competencies,
    successStatement,
    total: weightsTotal(competencies),
    canSave: canSave(competencies) && !pending,
    pending,
    status,
    onStart: () => {
      if (!edit) return;
      setCompetencies(edit.competencies);
      setSuccessStatement(edit.successStatement);
      setBase(edit.base);
      setStatus('idle');
      setEditing(true);
    },
    onCancel: () => setEditing(false),
    onChange: change,
    onAdd: () => setCompetencies((list) => [...list, newCompetency()]),
    onRemove: (index: number) => setCompetencies((list) => list.filter((_, i) => i !== index)),
    onSuccessStatement: setSuccessStatement,
    onSave: () => save(false),
    onSend: () => save(true),
  };
}
