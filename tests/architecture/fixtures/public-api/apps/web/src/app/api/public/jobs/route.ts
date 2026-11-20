import { createCandidates } from '@credalent/candidates/composition';
import { getDb } from '@/server/db';

export const GET = () => [createCandidates, getDb];
