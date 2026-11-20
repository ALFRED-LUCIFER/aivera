// The allowed contract passes; the app's pool through a relative path does not.
import type { WorkspaceSummary } from '@credalent/workspaces';
import { getDb } from '../../../../server/db';

export default async function Page() {
  await platformOperator();
  return [getDb, null as WorkspaceSummary | null];
}
