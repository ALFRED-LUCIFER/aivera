import { createCandidates } from '@aivera/candidates/composition';
import { getDb } from '@/server/db';

export const GET = () => [createCandidates, getDb];
