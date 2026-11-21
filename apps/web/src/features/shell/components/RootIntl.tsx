'use client';

import { IntlProvider } from '@credalent/i18n/react';
import type { ComponentProps } from 'react';

/** The root layout's provider (a Server Component cannot render IntlProvider itself); the root error page reads it. */
export const RootIntl = (props: ComponentProps<typeof IntlProvider>) => <IntlProvider {...props} />;
