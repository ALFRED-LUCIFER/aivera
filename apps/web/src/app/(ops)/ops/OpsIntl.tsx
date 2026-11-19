'use client';

import { IntlProvider } from '@aivera/i18n/react';
import type { ComponentProps } from 'react';

/** Client translations for the console's pages, from the same config as the server's t() (intlConfig). */
export function OpsIntl(props: ComponentProps<typeof IntlProvider>) {
  return <IntlProvider {...props} />;
}
