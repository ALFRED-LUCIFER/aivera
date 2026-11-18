import { describe, expect, it, vi } from 'vitest';
import { generateMetadata as appLayout } from './layout.tsx';
import { generateMetadata as inbox } from './inbox/page.tsx';
import { generateMetadata as jobs } from './jobs/page.tsx';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

describe('page titles (WCAG 2.4.2)', () => {
  // SAFETY: mutation check: inbox page used screenMetadata('jobs') -> this test failed
  it('each section has its own title inside the "· Aivera" template', async () => {
    expect((await inbox()).title).toBe('Inbox');
    expect((await jobs()).title).toBe('Jobs');
    expect((await appLayout()).title).toEqual({ template: '%s · Aivera', default: 'Aivera' });
  });
});
