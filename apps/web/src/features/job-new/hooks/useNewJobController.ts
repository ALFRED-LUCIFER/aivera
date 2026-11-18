import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';
import { initialNewJobState } from '../domain/jobNew.ts';
import { addJob } from '../services/addJob.ts';

/**
 * Step 1 of Add a job: the posted action and its last result, the chosen job type (it drives the description
 * placeholder), and Cancel, which asks "Discard this job?" first once anything was typed.
 */
export function useNewJobController(defaultJobType: string) {
  const [state, action, pending] = useActionState(addJob, initialNewJobState(defaultJobType));
  const [jobType, setJobType] = useState(state.values.jobType);
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
    onInput: () => setDirty(true),
    onCancel: () => (dirty ? setDiscardOpen(true) : leave()),
    discardOpen,
    onDiscardOpenChange: setDiscardOpen,
    onDiscard: leave,
  };
}
