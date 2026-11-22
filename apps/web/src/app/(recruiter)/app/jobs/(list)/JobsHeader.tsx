import { buttonClassName } from '@credalent/ui';
import Link from 'next/link';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

/** The Jobs heading, shared by the page, its loading skeleton and its error state. */
export function JobsHeader({ title, intro, add }: { title: string; intro: string; add: string | null }) {
  return (
    <>
      <PageHeader
        title={title}
        actions={
          // Null for roles without `job.create` (hiring owners, interviewers): the server refuses it anyway.
          add && (
            <Link href="/app/jobs/new" className={buttonClassName('primary')}>
              {add}
            </Link>
          )
        }
      />
      <p className="-mt-3 mb-6 max-w-prose text-body text-text-2">{intro}</p>
    </>
  );
}
