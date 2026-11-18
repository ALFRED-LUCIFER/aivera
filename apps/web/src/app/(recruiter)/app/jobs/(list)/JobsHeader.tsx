import { buttonClassName } from '@aivera/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

/** The Jobs heading, shared by the page, its loading skeleton and its error state. */
export function JobsHeader({ title, intro, add }: { title: string; intro: string; add: string }) {
  return (
    <>
      <PageHeader
        title={title}
        actions={
          // shortcut: the add-job page arrives with AIV-P1-007, so the route is not typed yet; drop the cast then.
          <Link href={'/app/jobs/new' as Route} className={buttonClassName('primary')}>
            {add}
          </Link>
        }
      />
      <p className="-mt-3 mb-6 max-w-prose text-body text-text-2">{intro}</p>
    </>
  );
}
