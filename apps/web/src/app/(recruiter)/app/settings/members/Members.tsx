'use client';

import { InviteForm } from '@/features/members/components/InviteForm.tsx';
import { MembersTable } from '@/features/members/components/MembersTable.tsx';
import type { MemberRow, Option } from '@/features/members/domain/members.ts';
import { useInviteController } from '@/features/members/hooks/useInviteController.ts';
import { useMembersController } from '@/features/members/hooks/useMembersController.ts';

type Props = { rows: MemberRow[]; jobs: Option[]; clients: Option[] | null };

export function Members({ rows, jobs, clients }: Props) {
  const invite = useInviteController();
  const manage = useMembersController();
  return (
    <div className="flex flex-col gap-10">
      <MembersTable rows={rows} jobs={jobs} clients={clients} {...manage} />
      <InviteForm jobs={jobs} clients={clients} {...invite} />
    </div>
  );
}
