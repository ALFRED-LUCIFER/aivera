'use server';

import { cookies } from 'next/headers';
import { publicEntry } from '@/server/publicEntry';
import { parseTheme, themeCookie } from '../domain/shell.ts';

const oneYear = 60 * 60 * 24 * 365;

// shortcut: the theme lives in a browser cookie, not on the member; moves to the user settings with sign-in (AIV-P0-010).
export const setTheme = publicEntry(
  "sets only the caller's own theme cookie; the value is parsed to light or dark",
  async (theme: unknown) => {
    (await cookies()).set(themeCookie, parseTheme(theme), {
      path: '/',
      maxAge: oneYear,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
  },
);
