import { createHash, timingSafeEqual } from 'node:crypto';
import { handleEventGrid, ReportTooEarly } from '@credalent/notifications/composition';
import { log } from '@credalent/observability';
import { z } from 'zod';
import { getDb } from '@/server/db';
import { env } from '@/server/env';

// Public: the Event Grid webhook for ACS email delivery reports (AIV-P0-017). Event Grid signs nothing itself; rather
// than an Entra app registration for delivery auth, the dev subscription URL carries a secret key (Key Vault
// acs-webhook-key; telemetry strips query strings). Off (404) until the key is set. The body names a recipient: it is
// never logged.
// shortcut: each early report answers 503 until the worker commits, and those retries count toward the web 5xx alert
// (infra/modules/alerts.bicep); leave this route out of that query if the alert gets noisy (AIV-P5-010)

const digest = (value: string) => createHash('sha256').update(value).digest();
const matches = (given: string | null, expected: string) =>
  given !== null && timingSafeEqual(digest(given), digest(expected));

export async function POST(request: Request): Promise<Response> {
  const key = env().ACS_WEBHOOK_KEY;
  if (!key) return new Response(null, { status: 404 });
  if (!matches(new URL(request.url).searchParams.get('key'), key)) return new Response(null, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  try {
    const result = await handleEventGrid(getDb(), body);
    if ('validationResponse' in result) return Response.json(result);
    log.info({ area: 'acs-email', code: String(result.updated) }, 'delivery reports applied');
    return new Response(null, { status: 200 });
  } catch (error) {
    // A body that is not Event Grid's is refused. A report ahead of the worker's commit, or any other failure, gets a
    // 5xx so Event Grid retries (for up to 24 hours).
    if (error instanceof z.ZodError) return new Response(null, { status: 400 });
    if (error instanceof ReportTooEarly) return new Response(null, { status: 503 });
    log.error({ err: error, area: 'acs-email' }, 'delivery report failed');
    return new Response(null, { status: 500 });
  }
}
