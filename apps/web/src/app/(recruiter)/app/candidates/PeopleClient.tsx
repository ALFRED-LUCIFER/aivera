'use client';

import { People } from '@/features/people/components/People.tsx';
import type { PeopleData } from '@/features/people/domain/people.ts';
import { usePeopleController } from '@/features/people/hooks/usePeopleController.ts';

export function PeopleClient({ data }: { data: PeopleData }) {
  return <People view={usePeopleController(data)} />;
}
