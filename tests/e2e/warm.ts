import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type FullConfig } from '@playwright/test';
import { signIn } from './src/auth.ts';

// Playwright global setup, after seed.ts: `next dev` compiles a route on its first request, which takes seconds on a CI
// runner while two workers run tests. The first test to reach a route then spends its step timeouts on the compiler,
// not on the app (main went red that way: job-header's rubric page, the ops-audit and ops-suspend console pages).
// Opening every page once here compiles them all before any test starts, as a deployed build would have them.

const appDir = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src', 'app');
/** Any id in a dynamic segment: the route compiles whether or not the record exists. */
const anyId = '00000000-0000-7000-8000-000000000000';

/** Every page route of apps/web as a URL path: route groups dropped, dynamic segments filled. */
export const pagePaths = (): string[] =>
  readdirSync(appDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /(^|\/)page(\.dev)?\.tsx$/.test(file))
    .map(
      (file) =>
        `/${file
          .split('/')
          .slice(0, -1)
          .filter((segment) => !segment.startsWith('(') && !segment.startsWith('[[...'))
          .map((segment) => (segment.startsWith('[') ? anyId : segment))
          .join('/')}`,
    );

/** Opens the paths four at a time: Turbopack compiles them in parallel. */
async function open(context: BrowserContext, paths: string[]) {
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      const page = await context.newPage();
      for (let path = queue.shift(); path; path = queue.shift()) await page.goto(path, { timeout: 120_000 });
      await page.close();
    }),
  );
}

/** Signs in through the mocked tenant (the proxy sends a request without a session to sign-in, uncompiled). */
async function signedIn(context: BrowserContext, baseURL: string, from: string, email: string) {
  const page = await context.newPage();
  await signIn(page, { email, from });
  await page.waitForURL((url) => url.origin === new URL(baseURL).origin && !url.pathname.includes('sign-in'));
  await page.close();
  return context;
}

export default async function warm(config: FullConfig) {
  const baseURL = config.projects.find((project) => project.name === 'gallery')?.use.baseURL ?? '';
  const browser = await chromium.launch();
  try {
    const paths = pagePaths();
    const candidate = paths.filter((path) => path.startsWith('/candidates/me'));
    // AP (seed.ts) reaches the recruiter pages; the console pages compile for her too and answer 403.
    const [recruiter, candidateContext] = await Promise.all([
      signedIn(await browser.newContext({ baseURL }), baseURL, '/sign-in', 'ap@example.com'),
      signedIn(await browser.newContext({ baseURL }), baseURL, '/candidates/sign-in', 'sara@example.com'),
    ]);
    await Promise.all([
      open(
        recruiter,
        paths.filter((path) => !candidate.includes(path)),
      ),
      open(candidateContext, candidate),
    ]);
  } finally {
    await browser.close();
  }
}
