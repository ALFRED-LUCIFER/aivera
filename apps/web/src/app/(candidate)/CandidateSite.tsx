'use client';

import { IntlProvider } from '@aivera/i18n/react';
import type { ComponentProps, ReactNode } from 'react';
import { CandidateShell } from '@/features/candidate-shell/components/CandidateShell.tsx';
import { useCandidateShellController } from '@/features/candidate-shell/hooks/useCandidateShellController.ts';

type Props = {
  intl: Omit<ComponentProps<typeof IntlProvider>, 'children'>;
  signedIn: boolean;
  children: ReactNode;
};

export function CandidateSite({ intl, signedIn, children }: Props) {
  const controller = useCandidateShellController();
  return (
    <IntlProvider {...intl}>
      <CandidateShell signedIn={signedIn} {...controller}>
        {children}
      </CandidateShell>
    </IntlProvider>
  );
}
