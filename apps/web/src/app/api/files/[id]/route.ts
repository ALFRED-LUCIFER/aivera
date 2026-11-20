import { forbidden } from 'next/navigation';
import { fileIdSchema } from '@/features/files/domain/files';
import { getFiles } from '@/server/files';
import { inActiveWorkspace } from '@/server/workspace';

// A clean file's download (AIV-P0-016): the signed-in member's active workspace, `file.download` (job-scoped roles are
// refused until files reach them through a candidate's job), and only a `clean` file. Streamed through the app, never a
// public or signed blob URL. The path holds the opaque file id only; nothing about the file is logged.
export async function GET(_request: Request, { params }: RouteContext<'/api/files/[id]'>): Promise<Response> {
  const id = fileIdSchema.safeParse((await params).id);
  const files = getFiles()?.files;
  if (!id.success || !files) return new Response(null, { status: 404 });
  const result = await inActiveWorkspace((ctx) => files.openDownload(ctx, id.data));
  if (!result) forbidden();
  // Another workspace's file, a missing one and one not clean all read the same: not found.
  if (!result.value) return new Response(null, { status: 404 });
  const { body, contentType, sizeBytes } = result.value;
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'content-length': String(sizeBytes),
      // Saved, never rendered in the app's origin; no name, since none is stored (it can name the candidate).
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      'cache-control': 'private, no-store',
    },
  });
}
