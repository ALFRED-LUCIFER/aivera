'use client';

import { useTranslations } from '@credalent/i18n/react';
import { SuccessBanner } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCvRetryController, useLiveRefresh } from '@/features/evidence-profile';
import { CandidateProfile } from '@/features/evidence-profile/components/CandidateProfile.tsx';
import type { interviewAction, neighbours, primaryAction } from '@/features/evidence-profile/domain/actions.ts';
import { IN_PROGRESS } from '@/features/evidence-profile/domain/cvStatus.ts';
import type { ProfileData } from '@/features/evidence-profile/domain/profile.ts';
import { useNameController } from '@/features/evidence-profile/hooks/useNameController.ts';
import { scorecardHref } from '@/features/interviews/domain/interviews.ts';
import { useStartController } from '@/features/interviews/hooks/useStartController.ts';
import { AddToPack } from '@/features/ranking/components/AddToPack.tsx';
import { ChooseForInterview } from '@/features/ranking/components/ChooseForInterview.tsx';
import { packHref } from '@/features/ranking/domain/pack.ts';
import type { CandidateRow, PackChoice } from '@/features/ranking/domain/ranking.ts';
import { useChooseController } from '@/features/ranking/hooks/useChooseController.ts';
import { usePackController } from '@/features/ranking/hooks/usePackController.ts';

/** What the profile's header acts on, decided on the server from the job's ranking and the member's role. */
export type ProfileNext = {
  /** The candidate's row of the ranking, which the ranking's own previews read; null when the ranking does not list them. */
  row: CandidateRow | null;
  packs: PackChoice[];
  primary: ReturnType<typeof primaryAction>;
  interview: ReturnType<typeof interviewAction>;
} & ReturnType<typeof neighbours>;

const nothing = () => {};

/**
 * The profile with its CV's "Try again" (AIV-P1-134), refreshing itself while the CV is read or assessed, so it shows
 * the name and scores once scoring finishes, without a reload (AIV-P1-165 §7, §11). Its one primary action opens the
 * ranking's own preview of "Choose for interview" or "Add to decision pack" for this one candidate: nothing changes
 * until a person confirms (AGENTS.md 1.5).
 */
export function ProfileLive({
  profile,
  candidateId,
  linkCandidates,
  next,
  children,
}: {
  profile: ProfileData;
  candidateId: string;
  linkCandidates: boolean;
  next: ProfileNext;
  children?: ReactNode;
}) {
  const t = useTranslations('ranking');
  useLiveRefresh(profile.cv !== null && IN_PROGRESS.includes(profile.cv.state));
  const retry = useCvRetryController();
  const { jobId } = profile;
  const rows = next.row ? [next.row] : [];
  const choose = useChooseController({ jobId, rows }, t('choose.defaultReason'), nothing);
  const pack = usePackController({ jobId, rows, packs: next.packs }, t('pack.defaultReason'), nothing);
  const start = useStartController();
  const rename = useNameController({ candidateId, jobId }, profile.name ?? '');
  const open = next.primary === 'choose' ? choose.onPreview : pack.onPreview;
  const { row, interview } = next;
  return (
    <CandidateProfile
      view={{ status: 'ready', ...profile }}
      linkCandidates={linkCandidates}
      retry={retry}
      rename={profile.canRename ? rename : undefined}
      actions={{
        primary: next.primary && row ? { kind: next.primary, onOpen: () => open([row.id]) } : null,
        interview:
          interview &&
          (interview.kind === 'start'
            ? { kind: 'start', pending: start.pending, onStart: () => start.onStart(interview.interviewId) }
            : { kind: 'open', href: scorecardHref(interview.interviewId) }),
        previous: next.previous,
        next: next.next,
      }}
      banner={
        <>
          <SuccessBanner>{choose.done !== null && t('choose.done', { count: choose.done })}</SuccessBanner>
          <ChooseForInterview view={choose} />
          <SuccessBanner>
            {pack.done && (
              <>
                {t('pack.done', { count: pack.done.added, name: pack.done.name })}{' '}
                {/* packHref builds the path from opaque ids, which typed routes cannot check. */}
                <Link href={packHref(jobId, pack.done.packId) as Route} className="underline underline-offset-3">
                  {t('pack.open')}
                </Link>
              </>
            )}
          </SuccessBanner>
          <AddToPack view={pack} />
        </>
      }
    >
      {children}
    </CandidateProfile>
  );
}
