import { env } from '../../../server/env';
import { publicEntry } from '../../../server/publicEntry';

// Liveness probe. No dependencies, no data beyond the running commit and environment.
export const GET = publicEntry('liveness probe; returns the commit and environment, no data', (): Response => {
  const { COMMIT_SHA, APP_ENV } = env();
  return Response.json({ status: 'ok', commit: COMMIT_SHA, env: APP_ENV });
});
