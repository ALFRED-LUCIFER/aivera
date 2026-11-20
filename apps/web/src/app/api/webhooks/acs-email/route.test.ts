import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleEventGrid = vi.fn();
class ReportTooEarly extends Error {}
let key: string | undefined;
vi.mock('@credalent/notifications/composition', () => ({ handleEventGrid, ReportTooEarly }));
vi.mock('@/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@/server/env', () => ({ env: () => ({ ACS_WEBHOOK_KEY: key }) }));

const KEY = 'k'.repeat(40);
const post = async (query: string, body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request(`https://credalent.example/api/webhooks/acs-email${query}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
};

beforeEach(() => {
  handleEventGrid.mockReset();
  key = KEY;
});

describe('POST /api/webhooks/acs-email (AIV-P0-017)', () => {
  // SAFETY: mutation check: matches() always true -> this test failed (200 without the key)
  it('refuses a request without the subscription key, or with a wrong one, before reading the body', async () => {
    expect((await post('', [])).status).toBe(401);
    expect((await post('?key=wrong', [])).status).toBe(401);
    expect(handleEventGrid).not.toHaveBeenCalled();
  });

  it('is off (404) until the key is configured', async () => {
    key = undefined;
    expect((await post(`?key=${KEY}`, [])).status).toBe(404);
  });

  it('answers the Event Grid handshake and applies delivery reports', async () => {
    handleEventGrid.mockResolvedValueOnce({ validationResponse: 'code-1' });
    const handshake = await post(`?key=${KEY}`, [{ eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent' }]);
    expect(await handshake.json()).toEqual({ validationResponse: 'code-1' });

    handleEventGrid.mockResolvedValueOnce({ updated: 1 });
    expect((await post(`?key=${KEY}`, [{ eventType: 'x' }])).status).toBe(200);
  });

  it('refuses a body that is not Event Grid events with 400', async () => {
    handleEventGrid.mockRejectedValueOnce(z.array(z.object({ eventType: z.string() })).safeParse({}).error);
    expect((await post(`?key=${KEY}`, { not: 'events' })).status).toBe(400);
  });

  it('answers 503 to a report that arrived before the send was recorded, so Event Grid retries', async () => {
    handleEventGrid.mockRejectedValueOnce(new ReportTooEarly());
    expect((await post(`?key=${KEY}`, [{ eventType: 'x' }])).status).toBe(503);
  });
});
