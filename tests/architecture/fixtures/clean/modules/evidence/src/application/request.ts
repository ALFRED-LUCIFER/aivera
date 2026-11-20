import type { JobId } from '@credalent/jobs';
import { local } from '../domain/local.ts';
export const x = (id: JobId) => local(id);
