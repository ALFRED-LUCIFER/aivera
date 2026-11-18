import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json' with { type: 'json' };
import {
  defaultTimeZone,
  dir,
  formatDate,
  formatMoney,
  formatPercent,
  getTranslations,
  withEnglishFallback,
} from '../src/index.ts';

afterEach(() => vi.restoreAllMocks());

describe('plurals and formats in en-AE', () => {
  it.each([
    [1, '1 evidence request sent'],
    [3, '3 evidence requests sent'],
  ])('evidence.requests.sent with %i is "%s"', async (count, text) => {
    const t = await getTranslations('en', defaultTimeZone);
    expect(t('evidence.requests.sent', { count })).toBe(text);
  });

  it('money.monthly with 49 is "AED 49 a month"', async () => {
    const t = await getTranslations('en', defaultTimeZone);
    expect(t('money.monthly', { amount: formatMoney({ amountMinor: 4900, currency: 'AED' }, 'en') })).toBe(
      'AED\u00a049 a month', // Intl keeps the currency and amount together with a no-break space
    );
  });

  it('date.short with 2026-11-18 is "18 Nov 2026", in the time zone given rather than the machine one', async () => {
    const lateEvening = new Date('2026-11-17T21:30:00Z'); // already 18 Nov in Dubai, still 17 Nov in UTC
    const t = await getTranslations('en', 'Asia/Dubai');
    expect(t('date.short', { value: lateEvening })).toBe('18 Nov 2026');
    expect(formatDate(lateEvening, 'en', 'Asia/Dubai')).toBe('18 Nov 2026');
    expect(formatDate(lateEvening, 'en', 'UTC')).toBe('17 Nov 2026');
  });

  it('formats money with cents and percentages', () => {
    expect(formatMoney({ amountMinor: 4950, currency: 'AED' }, 'en')).toBe('AED\u00a049.50');
    expect(formatPercent(0.71, 'en')).toBe('71%');
  });
});

describe('typed keys', () => {
  it('a misspelt key is a type error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = await getTranslations('en', defaultTimeZone);
    // SAFETY: mutation check: cast `messages` to Record<string, any> in getTranslations -> tsc failed on this unused @ts-expect-error
    // @ts-expect-error "sned" is not a key in messages/en.json
    expect(t('evidence.request.sned')).toBe('evidence.request.sned');
    expect(t('evidence.request.send')).toBe('Send request');
  });
});

describe('direction follows the locale', () => {
  it.each([
    ['en', 'ltr'],
    ['en-AE', 'ltr'],
    ['ar', 'rtl'],
    ['ar-AE', 'rtl'],
  ])('%s is %s', (locale, expected) => {
    expect(dir(locale)).toBe(expected);
  });
});

describe('a missing translation falls back to English', () => {
  it('shows English for the missing key and warns with the key name only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ar = { ...en, home: { ...en.home, signIn: undefined }, app: { title: 'أيفيرا' } };
    // SAFETY: mutation check: withEnglishFallback returned the locale messages unfilled -> this test failed
    const messages = withEnglishFallback('ar', JSON.parse(JSON.stringify(ar)));
    expect(messages.home.signIn).toBe('Sign in');
    expect(messages.app.title).toBe('أيفيرا');
    expect(messages.app.description).toBe(en.app.description);
    expect(warn).toHaveBeenCalledExactlyOnceWith('i18n: ar falls back to English for app.description, home.signIn');
  });

  it('the English catalogue has every key and warns about nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(withEnglishFallback('en', en)).toEqual(en);
    expect(warn).not.toHaveBeenCalled();
  });
});

// AIV-P0-023: the score components take this wording through props.
describe('score and competency wording', () => {
  it('reads as the Foundations and Candidate artboards', async () => {
    const t = await getTranslations('en', defaultTimeZone);
    expect(`${t('score.backed', { backed: 62 })} · ${t('score.upTo', { upTo: 78 })}`).toBe(
      '62 backed by evidence · up to 78 if claims hold in interview',
    );
    expect(t('score.level', { proven: 1, levels: 5, needed: 2 })).toBe('Proven 1 of 5 · job needs 2');
    expect(t('score.shortClaimed', { short: 1 })).toBe('1 short, claimed');
    expect(t('competency.weightMandatory', { weight: formatPercent(0.2, 'en') })).toBe('Weight 20% · mandatory');
    expect(t('competency.sources', { count: 1 })).toBe('1 source');
    expect(t('competency.sources', { count: 2 })).toBe('2 sources');
  });
});
