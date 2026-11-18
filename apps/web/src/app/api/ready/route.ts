import { isReachable } from '@aivera/db/client';
import { getDb } from '../../../server/db';

// Public: readiness probe for Container Apps and the deploy smoke test. Names failing dependencies, nothing else.
export async function GET(): Promise<Response> {
  const failing = (await isReachable(getDb(), 2000)) ? [] : ['postgres'];
  return Response.json(failing.length ? { status: 'unavailable', failing } : { status: 'ok' }, {
    status: failing.length ? 503 : 200,
  });
}
