import { useTimeZone as useProviderTimeZone } from 'use-intl';
import type { Messages, formats } from './index.ts';

// Client components: wrap in <IntlProvider {...await intlConfig(locale, timeZone)}> from a Server Component (the same
// config getTranslations uses, so server and client print the same text), then call useTranslations().
export { IntlProvider, useTranslations } from 'use-intl';

/** The provider's time zone, to state beside dates it formats. intlConfig always sets one; a provider without it throws. */
export function useTimeZone(): string {
  const zone = useProviderTimeZone();
  if (!zone) throw new Error('IntlProvider has no timeZone: pass it intlConfig(locale, timeZone)');
  return zone;
}

// Types useTranslations() keys from the English catalogue, so a misspelt key fails typecheck.
declare module 'use-intl' {
  interface AppConfig {
    Messages: Messages;
    Formats: typeof formats;
  }
}
