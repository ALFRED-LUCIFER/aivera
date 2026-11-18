import { env } from '../../../server/env';

// Public: liveness probe. No dependencies, no data beyond the running commit and environment.
export function GET(): Response {
  const { COMMIT_SHA, APP_ENV } = env();
  return Response.json({ status: 'ok', commit: COMMIT_SHA, env: APP_ENV });
}
