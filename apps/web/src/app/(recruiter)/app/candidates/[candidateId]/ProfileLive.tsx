'use client';

import type { ReactNode } from 'react';
import { useCvRetryController, useLiveRefresh } from '@/features/evidence-profile';
import { CandidateProfile } from '@/features/evidence-profile/components/CandidateProfile.tsx';
import { IN_PROGRESS } from '@/features/evidence-profile/domain/cvStatus.ts';
import type { ProfileData } from '@/features/evidence-profile/domain/profile.ts';

/**
 * The profile with its CV's "Try again" (AIV-P1-134), refreshing itself while the CV is read or assessed, so it shows
 * the name and scores once scoring finishes, without a reload (AIV-P1-165 §7, §11).
 */
export function ProfileLive({
  profile,
  linkCandidates,
  children,
}: {
  profile: ProfileData;
  linkCandidates: boolean;
  children?: ReactNode;
}) {
  useLiveRefresh(profile.cv !== null && IN_PROGRESS.includes(profile.cv.state));
  const retry = useCvRetryController();
  return (
    <CandidateProfile view={{ status: 'ready', ...profile }} linkCandidates={linkCandidates} retry={retry}>
      {children}
    </CandidateProfile>
  );
}
