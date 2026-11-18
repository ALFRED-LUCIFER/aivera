import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('./GalleryClient.tsx', () => ({ GalleryClient: () => null }));
const { default: GalleryPage } = await import('./page.dev.tsx');

describe('Scenario: The gallery is not shipped to production', () => {
  afterEach(() => vi.unstubAllEnvs());

  // SAFETY: mutation check: removed the NODE_ENV guard in page.dev.tsx -> "%s builds get a 404" failed for production and test
  it.each(['production', 'test'])('%s builds get a 404', async (env) => {
    vi.stubEnv('NODE_ENV', env);
    await expect(GalleryPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders under next dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await expect(GalleryPage()).resolves.toBeTruthy();
  });
});
