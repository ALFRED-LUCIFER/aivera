import { defaultLocale, defaultTimeZone, intlConfig } from '@aivera/i18n';
import { notFound } from 'next/navigation';
import { GalleryClient } from './GalleryClient.tsx';

/** The @aivera/ui gallery for Playwright (axe and visual snapshots). Development only: 404 in every other build. */
export default async function GalleryPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <GalleryClient intl={await intlConfig(defaultLocale, defaultTimeZone)} />;
}
