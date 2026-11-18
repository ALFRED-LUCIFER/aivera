'use client';

import { IntlProvider } from '@aivera/i18n/react';
import type { ComponentProps } from 'react';
import { AppShell, type AppShellProps } from '@/features/shell/components/AppShell.tsx';
import type { Theme } from '@/features/shell/domain/shell.ts';
import { useShellController } from '@/features/shell/hooks/useShellController.ts';

type Props = Pick<AppShellProps, 'member' | 'counts' | 'screens' | 'children'> & {
  intl: Omit<ComponentProps<typeof IntlProvider>, 'children'>;
  theme: Theme;
};

export function RecruiterShell({ intl, theme, ...props }: Props) {
  const controller = useShellController(theme);
  return (
    <IntlProvider {...intl}>
      <AppShell {...props} {...controller} />
    </IntlProvider>
  );
}
