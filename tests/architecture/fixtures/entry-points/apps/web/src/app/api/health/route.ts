import { publicEntry } from '@/server/publicEntry';

const handler = () => Response.json({ status: 'ok' });

// Declared: publicEntry with its reason. Not an HTTP method, so not an entry point.
export const GET = publicEntry('health probe, returns no data', handler);
export const revalidate = 0;
