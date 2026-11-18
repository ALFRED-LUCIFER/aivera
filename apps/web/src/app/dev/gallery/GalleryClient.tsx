'use client';

import { IntlProvider } from '@aivera/i18n/react';
import type { ComponentProps } from 'react';
import { Gallery } from '@/features/gallery/components/Gallery.tsx';
import { useGalleryController } from '@/features/gallery/hooks/useGalleryController.ts';

export function GalleryClient({ intl }: { intl: Omit<ComponentProps<typeof IntlProvider>, 'children'> }) {
  const controller = useGalleryController();
  return (
    <IntlProvider {...intl}>
      <Gallery {...controller} />
    </IntlProvider>
  );
}
