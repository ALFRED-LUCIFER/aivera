import { SLUG, toPublicJobJson } from '@credalent/jobs';
import { getPublicJobs } from '@/server/publicJobs';

// Public: one published job for the candidate site (AIV-P3-002), read as the aivera_public role. Only the strict public
// contract leaves, so a weight, client name, candidate, score or id cannot. Codes, not text: the pages own the words.
export async function GET(_request: Request, { params }: RouteContext<'/api/public/jobs/[slug]'>): Promise<Response> {
  const { slug } = await params;
  const found = slug.length <= 100 && SLUG.test(slug) ? await getPublicJobs().findPublicJob(slug) : null;
  if (!found) return Response.json({ error: 'not_found' }, { status: 404 });
  if (!found.open) return Response.json({ error: 'no_longer_open' }, { status: 404 });
  return Response.json(toPublicJobJson(found.job));
}
