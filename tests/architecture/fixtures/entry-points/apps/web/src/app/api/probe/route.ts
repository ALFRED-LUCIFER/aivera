import { publicEntry } from '@/server/publicEntry';

const handler = () => Response.json({ status: 'ok' });

// publicEntry without a reason: an empty one, a blank one, and one that is not a literal a reviewer can read.
export const GET = publicEntry('', handler);
export const HEAD = publicEntry('   ', handler);
const reason = 'probe';
export const OPTIONS = publicEntry(reason, handler);
