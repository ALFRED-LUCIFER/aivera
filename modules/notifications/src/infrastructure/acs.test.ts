import { describe, expect, it, vi } from 'vitest';
import type { SealedEmail } from '../application/emails.ts';
import { createAcsSender } from './acs.ts';

// AIV-P0-017: which ACS answers retry, which are final, and what an accepted send records. ACS faked at fetch.

const email: SealedEmail = {
  to: 'sara.alqahtani@example.com',
  replyTo: { name: 'Layla Haddad', shortName: 'Layla', email: 'layla.haddad@example.com', workspace: 'Demo Hiring Co' },
  subject: 'A request about your application: Senior AI Engineer',
  html: '<p>…</p>',
  text: '…',
};
const ID = '0190d4a2-0000-7000-8000-0000000000e1';
const sender = (response: () => Response) =>
  createAcsSender({
    endpoint: 'https://acs-aivera-dev.communication.azure.com',
    senderAddress: 'DoNotReply@credalent.example',
    token: async () => 'test-token',
    fetch: vi.fn(async () => response()),
  });

describe('createAcsSender', () => {
  it.each([401, 403, 404, 429, 500, 503])('throws on %i, so the worker retries', async (status) => {
    await expect(sender(() => new Response(null, { status }))(ID, email)).rejects.toThrow(`failed with ${status}`);
  });

  it.each([400, 422])('treats %i as a final refusal', async (status) => {
    expect(await sender(() => new Response(null, { status }))(ID, email)).toEqual({ accepted: false });
  });

  it("records ACS's message id on 202", async () => {
    const send = sender(() => Response.json({ id: 'acs-1', status: 'Running' }, { status: 202 }));
    expect(await send(ID, email)).toEqual({ accepted: true, providerMessageId: 'acs-1' });
  });

  it('keeps the operation id when a 202 has no readable id', async () => {
    expect(await sender(() => new Response(null, { status: 202 }))(ID, email)).toEqual({
      accepted: true,
      providerMessageId: ID,
    });
  });
});
