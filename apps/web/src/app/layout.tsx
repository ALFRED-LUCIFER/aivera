import { defaultLocale, defaultTimeZone, dir, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { readTheme } from '@/features/shell/services/request.ts';
import './globals.css';

// DESIGN.md typography: Bricolage Grotesque headings, Hanken Grotesk text, JetBrains Mono for evidence.
// Self-hosted, not next/font/google: Google Fonts serves differently instanced variable files from run to run, which
// moved glyphs by a pixel and failed visual snapshots at random (AIV-P0-921). The files are the OFL variable fonts of
// google/fonts@7af0d90 (ofl/<family>/*[wght].ttf), Bricolage first pinned with `fonttools varLib.instancer
// opsz=96 wdth=100` (Google's own pin), each then converted with every glyph, feature and name kept (licence fields):
// `pyftsubset <ttf> --unicodes='*' --layout-features='*' --name-IDs='*' --no-hinting --flavor=woff2`.
const bricolage = localFont({
  src: './fonts/bricolage-grotesque.woff2',
  weight: '200 800',
  variable: '--font-bricolage',
});
const hanken = localFont({ src: './fonts/hanken-grotesk.woff2', weight: '100 900', variable: '--font-hanken' });
const jetbrains = localFont({ src: './fonts/jetbrains-mono.woff2', weight: '100 800', variable: '--font-jetbrains' });

// shortcut: every visitor gets the default locale and time zone, until the user setting exists (sign-in, AIV-P1).
const locale = defaultLocale;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(locale, defaultTimeZone);
  return { title: t('app.title'), description: t('app.description') };
}

// The theme comes from the cookie on the server, so the first paint already has it (no flash).
// shortcut: reading the cookie makes every route render dynamically; revisit for the marketing and candidate sites
// (static pages with an inline theme script, or a theme read only in the /app layout).
export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={locale}
      dir={dir(locale)}
      data-theme={await readTheme()}
      className={`${bricolage.variable} ${hanken.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
