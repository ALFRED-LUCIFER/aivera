import { createTranslator } from 'use-intl/core';
import en from '../messages/en.json' with { type: 'json' };

// Adding a language (Arabic, AIV-P5-007) is its locale here plus messages/<locale>.json; components do not change.
const locales = ['en'] as const;
export type Locale = (typeof locales)[number];
export type Messages = typeof en;
export type Money = { amountMinor: number; currency: string };

export const defaultLocale: Locale = 'en';
export const defaultTimeZone = 'Asia/Dubai';

// Shared by messages ("{value, date, short}") and formatDate, so both print "18 Nov 2026".
export const formats = {
  dateTime: { short: { day: 'numeric', month: 'short', year: 'numeric' } },
} as const;

// shortcut: dates and numbers always use the UAE region, until workspaces carry a country (KSA becomes <lang>-SA).
const intlLocale = (locale: Locale) => `${locale}-AE`;

// Only Arabic among the planned languages is written right to left.
export const dir = (locale: string) => (new Intl.Locale(locale).language === 'ar' ? 'rtl' : 'ltr');

type Catalogue = { [key: string]: string | Catalogue };

/** Fills keys a locale lacks with English and warns with the key names only, never message values or user data. */
export function withEnglishFallback(locale: string, messages: Catalogue): Messages {
  const missing: string[] = [];
  const fill = (english: Catalogue, other: Catalogue, path: string): Catalogue =>
    Object.fromEntries(
      Object.entries(english).map(([key, value]) => {
        const found = other[key];
        if (typeof value === 'string') {
          if (typeof found !== 'string') missing.push(path + key);
          return [key, typeof found === 'string' ? found : value];
        }
        return [key, fill(value, typeof found === 'object' ? found : {}, `${path}${key}.`)];
      }),
    );
  const filled = fill(en, messages, '') as Messages;
  if (missing.length > 0) console.warn(`i18n: ${locale} falls back to English for ${missing.join(', ')}`);
  return filled;
}

/**
 * The one config for server t() and the client <IntlProvider {...await intlConfig(locale, timeZone)}>, so both print the
 * same text. The time zone is always explicit, never the machine's or the browser's (AGENTS.md 3.9).
 */
export async function intlConfig(locale: Locale, timeZone: string) {
  const catalogue = (await import(`../messages/${locale}.json`, { with: { type: 'json' } })) as { default: Catalogue };
  return { locale: intlLocale(locale), timeZone, formats, messages: withEnglishFallback(locale, catalogue.default) };
}

/** Server-side t() for pages, route handlers and email templates. */
export async function getTranslations(locale: Locale, timeZone: string) {
  return createTranslator(await intlConfig(locale, timeZone));
}

export const formatDate = (value: Date, locale: Locale, timeZone: string) =>
  new Intl.DateTimeFormat(intlLocale(locale), { ...formats.dateTime.short, timeZone }).format(value);

/** Money is integer minor units (AGENTS.md 3.8); whole amounts print without decimals ("AED 49"). */
export function formatMoney({ amountMinor, currency }: Money, locale: Locale) {
  const format = new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    trailingZeroDisplay: 'stripIfInteger',
  });
  // shortcut: Intl display digits as the minor-unit exponent are right for AED/SAR/KWD/BHD/OMR; use an ISO 4217 minor-unit table when other currencies appear
  return format.format(amountMinor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}

/** The amount alone, for the upper end of a range ("AED 35,000 to 48,000"): same digits as formatMoney, no currency. */
export function formatAmount({ amountMinor, currency }: Money, locale: Locale) {
  const digits =
    new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    trailingZeroDisplay: 'stripIfInteger',
  }).format(amountMinor / 10 ** digits);
}

/** A ratio from 0 to 1 ("0.71" prints "71%"). */
export const formatPercent = (ratio: number, locale: Locale) =>
  new Intl.NumberFormat(intlLocale(locale), { style: 'percent' }).format(ratio);
