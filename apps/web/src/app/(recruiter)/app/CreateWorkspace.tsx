'use client';

import type { ComponentProps } from 'react';
import { CreateWorkspaceForm } from '@/features/workspace-signup/components/CreateWorkspaceForm.tsx';
import { useCreateWorkspaceController } from '@/features/workspace-signup/hooks/useCreateWorkspaceController.ts';

type Props = Pick<ComponentProps<typeof CreateWorkspaceForm>, 'labels' | 'focusOptions'> & { company: string };

export function CreateWorkspace({ company, ...props }: Props) {
  return <CreateWorkspaceForm {...props} {...useCreateWorkspaceController(company)} />;
}
