import type { JobId } from '@aivera/jobs';
import { local } from '../domain/local.ts';
export const x = (id: JobId) => local(id);
