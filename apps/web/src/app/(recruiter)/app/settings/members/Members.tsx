'use client';

import { InviteForm, InvitesOff } from '@/features/members/components/InviteForm.tsx';
import { MembersTable } from '@/features/members/components/MembersTable.tsx';
import type { MemberRow, Option } from '@/features/members/domain/members.ts';
import { useInviteController } from '@/features/members/hooks/useInviteController.ts';
import { useMembersController } from '@/features/members/hooks/useMembersController.ts';

type Props = { rows: MemberRow[]; jobs: Option[]; clients: Option[] | null; outbound: boolean };

export function Members({ rows, jobs, clients, outbound }: Props) {
  const invite = useInviteController();
  const manage = useMembersController();
  return (
    <div className="flex flex-col gap-10">
      <MembersTable rows={rows} jobs={jobs} clients={clients} {...manage} />
      {/* No invitation can be sent while outbound email is off (OUTBOUND, AIV-P1-165): say so rather than fail. */}
      {outbound ? <InviteForm jobs={jobs} clients={clients} {...invite} /> : <InvitesOff />}
    </div>
  );
}
