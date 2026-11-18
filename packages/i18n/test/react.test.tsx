import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getTranslations, intlConfig } from '../src/index.ts';
import { IntlProvider, useTranslations } from '../src/react.ts';

const lateEvening = new Date('2026-11-17T21:30:00Z'); // already 18 Nov in Dubai, still 17 Nov in UTC

function ShortDate() {
  return <>{useTranslations()('date.short', { value: lateEvening })}</>;
}

// Type-only: never called. A misspelt key in useTranslations() fails typecheck.
// SAFETY: mutation check: removed Messages from the `declare module 'use-intl'` AppConfig -> tsc failed on this unused @ts-expect-error
export const misspelt = () =>
  useTranslations()(
    // @ts-expect-error "sigIn" is not a key in messages/en.json
    'home.sigIn',
  );

describe('server and client share one config', () => {
  it('print the same date in the given time zone', async () => {
    const config = await intlConfig('en', 'Asia/Dubai');
    const client = renderToStaticMarkup(
      <IntlProvider {...config}>
        <ShortDate />
      </IntlProvider>,
    );
    const server = (await getTranslations('en', 'Asia/Dubai'))('date.short', { value: lateEvening });
    expect(client).toBe('18 Nov 2026');
    expect(server).toBe(client);
  });
});
