import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import RootLayout from './layout.tsx';

let themeCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (themeCookie === undefined ? undefined : { value: themeCookie }) }),
}));
vi.mock('next/font/google', () => ({
  Bricolage_Grotesque: () => ({ variable: 'font' }),
  Hanken_Grotesk: () => ({ variable: 'font' }),
  JetBrains_Mono: () => ({ variable: 'font' }),
}));

const tokens = JSON.parse(
  readFileSync(new URL('../../../../packages/tokens/src/tokens.json', import.meta.url), 'utf8'),
) as { color: Record<'light' | 'dark', Record<string, string>> };

const firstPaintTheme = async () =>
  ((await RootLayout({ children: null })) as ReactElement<{ 'data-theme': string }>).props['data-theme'];

describe('Scenario: Dark theme persists without a flash', () => {
  // SAFETY: mutation check: data-theme back to the literal "light" -> this test failed
  it('the server-rendered <html> carries the theme from the cookie, so the first paint is dark on #141118', async () => {
    themeCookie = 'dark';
    expect(await firstPaintTheme()).toBe('dark');
    expect(tokens.color.dark['bg']).toBe('#141118');
    themeCookie = undefined;
    expect(await firstPaintTheme()).toBe('light');
  });
});
