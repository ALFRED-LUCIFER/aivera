'use client';

import { IntlProvider } from '@credalent/i18n/react';
import type { ComponentProps } from 'react';
import { AppShell, type AppShellProps } from '@/features/shell/components/AppShell.tsx';
import type { Theme } from '@/features/shell/domain/shell.ts';
import { useShellController } from '@/features/shell/hooks/useShellController.ts';
import { signOut } from '@/features/sign-in/services/signOut.ts';

type Props = Pick<AppShellProps, 'member' | 'screens' | 'counts' | 'children'> & {
  intl: Omit<ComponentProps<typeof IntlProvider>, 'children'>;
  theme: Theme;
};

export function RecruiterShell({ intl, theme, ...props }: Props) {
  const controller = useShellController(theme);
  return (
    <IntlProvider {...intl}>
      <AppShell {...props} {...controller} signOutAction={signOut} />
    </IntlProvider>
  );
}
