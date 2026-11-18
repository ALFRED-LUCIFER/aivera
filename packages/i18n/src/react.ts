import type { Messages, formats } from './index.ts';

// Client components: wrap in <IntlProvider {...await intlConfig(locale, timeZone)}> from a Server Component (the same
// config getTranslations uses, so server and client print the same text), then call useTranslations().
export { IntlProvider, useTranslations } from 'use-intl';

// Types useTranslations() keys from the English catalogue, so a misspelt key fails typecheck.
declare module 'use-intl' {
  interface AppConfig {
    Messages: Messages;
    Formats: typeof formats;
  }
}
