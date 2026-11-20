// Imports workspaceAction but applies it to nothing: both handlers are undeclared.
import { workspaceAction } from '@/server/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getJobs().list());
}

export const POST = async (request: Request) => Response.json(await getJobs().create(await request.json()));

void workspaceAction;
