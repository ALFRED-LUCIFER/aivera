import type { Messages, formats } from './index.ts';

// Client components: wrap in <IntlProvider> with getTranslations' locale and messages, then call useTranslations().
export { IntlProvider, useTranslations } from 'use-intl';

// Types useTranslations() keys from the English catalogue, so a misspelt key fails typecheck.
declare module 'use-intl' {
  interface AppConfig {
    Messages: Messages;
    Formats: typeof formats;
  }
}
