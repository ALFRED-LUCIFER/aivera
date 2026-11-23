import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';
import { saveFailure } from '@/features/shell/domain/saveFailure.ts';
import { formValues, initialNewJobState, type NewJobState } from '../domain/jobNew.ts';
import { addJob } from '../services/addJob.ts';

/**
 * Add a job: the posted "Save job and rubric" action and its last result, the chosen job type (it drives the description
 * placeholder), the title as typed (step 2 names it), and Discard draft, which asks "Discard this job?" first once
 * anything was typed.
 */
export function useNewJobController(defaultJobType: string) {
  const [state, action, pending] = useActionState(
    async (previous: NewJobState, form: FormData): Promise<NewJobState> => {
      try {
        return await addJob(previous, form);
      } catch (error) {
        // A throw would reach the error boundary; the form is shown again with what was typed instead.
        return { errors: {}, error: saveFailure(error), saved: false, values: formValues(form) };
      }
    },
    initialNewJobState(defaultJobType),
  );
  const [jobType, setJobType] = useState(state.values.jobType);
  const [title, setTitle] = useState(state.values.title);
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const router = useRouter();
  const leave = () => router.push('/app/jobs');
  return {
    state,
    action,
    pending,
    jobType,
    onJobTypeChange: setJobType,
    title,
    onTitleChange: setTitle,
    onInput: () => setDirty(true),
    onCancel: () => (dirty ? setDiscardOpen(true) : leave()),
    discardOpen,
    onDiscardOpenChange: setDiscardOpen,
    onDiscard: leave,
  };
}
