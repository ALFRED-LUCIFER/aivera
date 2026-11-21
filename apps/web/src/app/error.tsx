'use client';

import { englishMessages } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { RootError } from '@/features/shell/components/RootError.tsx';

// The root layout has no provider (it would ship the whole catalogue to every page), so this boundary brings its own.
// The error is neither shown nor logged here; the server log has it by digest.
export default function RootErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <IntlProvider locale="en" messages={englishMessages}>
      <RootError onRetry={retry} />
    </IntlProvider>
  );
}
