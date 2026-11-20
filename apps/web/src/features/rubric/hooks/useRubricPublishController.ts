import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PublishView } from '../domain/rubric.ts';
import { publishListing } from '../services/publishListing.ts';

/**
 * The Publish panel (AIV-P1-015): "Publish this job" opens the preview; only "Publish" in it lists the job, and
 * "Unpublish" takes it off. Nothing changes on the server before either.
 */
export function useRubricPublishController(jobId: string, descriptor: string | null): PublishView {
  const router = useRouter();
  const [previewing, setPreviewing] = useState(false);
  const [typed, setTyped] = useState(descriptor ?? '');
  const [status, setStatus] = useState<PublishView['status']>('idle');
  const [pending, startTransition] = useTransition();
  const [returnFocus, setReturnFocus] = useState(false);

  return {
    previewing,
    descriptor: typed,
    pending,
    status,
    onPreview: () => {
      setStatus('idle');
      setReturnFocus(false);
      setPreviewing(true);
    },
    onCancel: () => {
      setPreviewing(false);
      setReturnFocus(true);
    },
    onDescriptor: setTyped,
    onPublish: async () => {
      const result = await publishListing({ jobId, publicDescriptor: typed });
      if ('error' in result) {
        setStatus(result.error);
        throw new Error(result.error);
      }
      setStatus('published');
      setPreviewing(false);
      router.refresh();
    },
    onUnpublish: () =>
      startTransition(async () => {
        const result = await publishListing({ jobId });
        setStatus('error' in result ? 'failed' : 'unpublished');
        router.refresh();
      }),
    returnFocus,
  };
}
