import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, isReachable } from '@credalent/db';
import { expect, it } from 'vitest';

// AIV-P0-007: /api/ready rests on isReachable; prove it against a real PostgreSQL that goes away.
it('is reachable while PostgreSQL is up and answers false within 3 seconds once it stops', async () => {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17').start();
  const db = createDb(container.getConnectionUri(), { max: 1 });
  try {
    expect(await isReachable(db, 2000)).toBe(true);
    await container.stop();
    const started = Date.now();
    expect(await isReachable(db, 2000)).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  } finally {
    await db.$client.end({ timeout: 0 });
  }
}, 120_000);
