import { beforeEach, describe, expect, it, vi } from 'vitest';

const isReachable = vi.fn<(db: unknown, timeoutMs: number) => Promise<boolean>>();
const createDb = vi.fn(() => ({}));
vi.mock('@aivera/db/client', () => ({ isReachable, createDb }));

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'dev');
  vi.stubEnv('COMMIT_SHA', 'abc1234');
  vi.stubEnv('DATABASE_URL', 'postgres://aivera_app@db.example:5432/aivera');
  isReachable.mockReset();
});

describe('GET /api/health', () => {
  it('returns 200 with the commit and environment, without touching the database', async () => {
    const { GET } = await import('./health/route');
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', commit: 'abc1234', env: 'dev' });
    expect(createDb).not.toHaveBeenCalled();
    expect(isReachable).not.toHaveBeenCalled();
  });
});

describe('GET /api/ready', () => {
  it('returns 503 naming postgres when the database does not answer within 2 seconds', async () => {
    isReachable.mockResolvedValue(false);
    const { GET } = await import('./ready/route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable', failing: ['postgres'] });
    expect(isReachable).toHaveBeenCalledWith(expect.anything(), 2000);
  });

  it('returns 200 when the database answers', async () => {
    isReachable.mockResolvedValue(true);
    const { GET } = await import('./ready/route');
    expect((await GET()).status).toBe(200);
  });
});
