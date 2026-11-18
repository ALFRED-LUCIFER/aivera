import { defaultLocale, defaultTimeZone, intlConfig } from '@aivera/i18n';
import { notFound } from 'next/navigation';
import { GalleryClient } from './GalleryClient.tsx';

/** The @aivera/ui gallery for Playwright (axe and visual snapshots). Development only: a build never routes page.dev.tsx (next.config.ts); the guard is a second layer. */
export default async function GalleryPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <GalleryClient intl={await intlConfig(defaultLocale, defaultTimeZone)} />;
}
