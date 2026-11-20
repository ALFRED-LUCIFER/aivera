import { createDb, type Db } from '@credalent/db/client';
import { env } from './env';

let db: Db | undefined;
/** The app's one connection pool, as the non-owner aivera_app role (row-level security applies, ADR-005). */
export const getDb = (): Db => (db ??= createDb(env().DATABASE_URL));
