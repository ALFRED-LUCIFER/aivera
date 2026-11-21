'use client';

import { IntlProvider } from '@credalent/i18n/react';
import type { ComponentProps } from 'react';

type Props = Omit<ComponentProps<typeof IntlProvider>, 'onError'>;

/**
 * Client translations from the server's intlConfig (a Server Component cannot render IntlProvider itself). The root
 * layout passes only the root error page's strings, so a client component outside a nested provider that asks for any
 * other key throws here instead of printing its key path.
 */
export function RootIntl(props: Props) {
  return (
    <IntlProvider
      {...props}
      onError={(error) => {
        if (error.code === 'MISSING_MESSAGE') throw error;
      }}
    />
  );
}
