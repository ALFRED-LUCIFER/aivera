import { createAudit } from '@credalent/audit/composition';
import type { OpsSettingsContract } from '@credalent/ops';
import { createOpsSettings } from '@credalent/ops/composition';
import { getDb } from './db';

let settings: OpsSettingsContract | undefined;
/**
 * The platform settings (AIV-P2-039): sign-up reads "New workspaces need approval" here; changing it goes through
 * server/operator.ts, behind the operator policy.
 */
export const getPlatformSettings = (): OpsSettingsContract =>
  (settings ??= createOpsSettings(getDb(), createAudit(getDb())));
