'use client';

import { useTranslations } from '@credalent/i18n/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { OpsShell, type OpsShellProps } from '@/features/ops/components/OpsShell.tsx';
import { activeOpsSection } from '@/features/ops/domain/ops.ts';
import type { Theme } from '@/features/shell/domain/shell.ts';
import { useShellController } from '@/features/shell/hooks/useShellController.ts';
import { signOut } from '@/features/sign-in/services/signOut.ts';

type Props = Pick<OpsShellProps, 'sections' | 'operator'> & {
  labels: Omit<OpsShellProps['labels'], 'theme'>;
  theme: Theme;
  children: ReactNode;
};

// The console frame with the current section from the path and the recruiter app's theme switch (same cookie).
export function OpsShellClient({ labels, theme, ...props }: Props) {
  const t = useTranslations('shell.theme');
  const controller = useShellController(theme);
  return (
    <OpsShell
      {...props}
      labels={{ ...labels, theme: controller.theme === 'dark' ? t('toLight') : t('toDark') }}
      activeId={activeOpsSection(usePathname())}
      onToggleTheme={controller.onToggleTheme}
      signOutAction={signOut}
    />
  );
}
