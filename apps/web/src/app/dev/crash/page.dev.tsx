/** A page that throws while rendering, so Playwright can reach the root error page. Development only, like the gallery. */
export default function CrashPage(): never {
  throw new Error('crash-page-secret-text');
}
