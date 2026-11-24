import { forbidden } from 'next/navigation';
import { fileIdSchema } from '@/features/files/domain/files';
import { getFiles } from '@/server/files';
import { inActiveWorkspace } from '@/server/workspace';

// Opens a candidate's uploaded evidence file from a source chip (AIV-P1-045): the signed-in member's active workspace,
// `file.download` (admins and recruiters; a hiring owner or interviewer gets the 403 page, AGENTS.md 1.9), a `clean`
// file only, and every link issued is audited by the files module. The answer is a redirect to a link that reads that
// one blob for 5 minutes. The path holds the opaque file id only; nothing about the file is logged.
export async function GET(_request: Request, { params }: RouteContext<'/api/files/[id]/link'>): Promise<Response> {
  const id = fileIdSchema.safeParse((await params).id);
  const files = getFiles()?.files;
  if (!id.success || !files) return new Response(null, { status: 404 });
  const result = await inActiveWorkspace((ctx) => files.issueReadLink(ctx, id.data));
  if (!result) forbidden();
  // Another workspace's file, a missing one and one not clean all read the same: not found.
  if (!result.value) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 302,
    headers: {
      location: result.value.url,
      // The signed link is never kept by the browser or a proxy, nor sent on as a referrer.
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
