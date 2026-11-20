import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, uuidv7, withWorkspace, type Db, type Envelope } from '@credalent/db';
import { createConsumer, type Delivery, type Handler } from '@credalent/db/consumer';
import { createRelay } from '@credalent/db/relay';
import { EmailError, EmailQueuedV1, type QueueEmailInput } from '@credalent/notifications';
import {
  createEmailHandler,
  createNotifications,
  handleEventGrid,
  NOTIFICATIONS_QUEUE,
  ReportTooEarly,
} from '@credalent/notifications/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// AIV-P0-017 acceptance scenarios against real PostgreSQL as aivera_app, the relay as aivera_relay. Service Bus is the
// relay's fake sender handing envelopes to the consumer; ACS is faked at the HTTP boundary (fetch). Synthetic cast.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const W1 = '0190d4a2-0000-7000-8000-000000000011';
const W2 = '0190d4a2-0000-7000-8000-000000000012';
const NOW = new Date('2026-11-10T10:00:00.000Z');
const KEY = randomBytes(32).toString('base64');
const SARA = 'sara.alqahtani@example.com';
const LAYLA = 'layla.haddad@example.com';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let relayDb: Db;
let acsCalls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[];
let acsStatus: number;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const notifications = () =>
  createNotifications({ encryptionKey: KEY, origin: 'https://credalent.example', synthetic: true, now: () => NOW });

const evidenceRequest = (overrides: Partial<QueueEmailInput<'evidence-request'>> = {}) =>
  ({
    template: 'evidence-request',
    to: SARA,
    causedBy: uuidv7(),
    sender: { name: 'Layla Haddad', shortName: 'Layla', email: LAYLA, workspace: 'Demo Hiring Co' },
    data: {
      jobTitle: 'Senior AI Engineer',
      items: [
        {
          competency: 'Cost and reliability',
          claim: 'I cut cost per request by 40%.',
          ask: 'Send a dashboard export, or a few lines on what you changed and how it was measured.',
        },
      ],
      link: 'https://credalent.example/l/9fK2xQ7mT4vB',
      deleteUrl: 'https://credalent.example/l/delete-9fK2xQ',
    },
    ...overrides,
  }) as QueueEmailInput<'evidence-request'>;

/** A recruiter's confirmed action: the email is queued in its workspace transaction. */
const confirm = (input = evidenceRequest(), workspaceId = W1) =>
  withWorkspace(app, workspaceId, (tx) => notifications().queueEmail({ tx, workspaceId }, input));

const row = async (id: string) =>
  (
    await admin.execute<{
      status: string;
      caused_by: string;
      provider_message_id: string | null;
      sealed: string;
      recipient_hash: string;
      sent_at: string | null;
    }>(
      sql`select status, caused_by, provider_message_id, sealed, recipient_hash, sent_at from notifications.message where id = ${id}`,
    )
  )[0];

/** One relay pass, and every envelope it sent handed to the worker's consumer for the notifications queue. */
async function relayAndConsume() {
  const sent: Envelope[] = [];
  await createRelay({
    db: relayDb,
    schemas: ['notifications'],
    queueFor: (type) => (type === EmailQueuedV1.type ? NOTIFICATIONS_QUEUE : undefined),
    send: async (_queue, envelope) => void sent.push(envelope),
    now: () => new Date(NOW.getTime() + 1000),
  })();
  const handler = createEmailHandler({
    encryptionKey: KEY,
    now: () => NOW,
    acs: {
      endpoint: 'https://acs-aivera-dev.communication.azure.com',
      senderAddress: 'DoNotReply@credalent.example',
      token: async () => 'test-token',
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        acsCalls.push({
          url: String(url),
          headers,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return acsStatus === 202
          ? Response.json({ id: `acs-${headers['operation-id']}`, status: 'Running' }, { status: 202 })
          : new Response(null, { status: acsStatus });
      }),
    },
  });
  const consumer = createConsumer({
    db: app,
    queue: NOTIFICATIONS_QUEUE,
    handlers: [handler as Handler<unknown>],
    now: () => NOW,
  });
  const settled: string[] = [];
  for (const envelope of sent) {
    const delivery: Delivery = {
      body: envelope,
      deliveryCount: 1,
      complete: async () => void settled.push('complete'),
      abandon: async () => void settled.push('abandon'),
      deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
    };
    await consumer.handle(delivery);
  }
  return settled;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  relayDb = createDb(urlFor('aivera_relay'), { max: 1 });
});

beforeEach(async () => {
  await admin.execute(sql`update notifications.outbox set sent_at = now() where sent_at is null`);
  acsCalls = [];
  acsStatus = 202;
});

afterAll(async () => {
  await Promise.all([app, admin, relayDb].map((db) => db?.$client.end()));
  await container?.stop();
});

describe('Scenario: An email is queued in the transaction and sent by the worker', () => {
  it('writes a queued row caused by the confirmed action, and the worker sends it and marks it sent', async () => {
    const input = evidenceRequest();
    const started = Date.now();
    const { messageId } = await confirm(input);
    expect(await row(messageId)).toMatchObject({ status: 'queued', caused_by: input.causedBy, sent_at: null });

    expect(await relayAndConsume()).toEqual(['complete']);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(await row(messageId)).toMatchObject({ status: 'sent', provider_message_id: `acs-${messageId}` });
    expect(new Date(String((await row(messageId))?.sent_at))).toEqual(NOW);
    expect(acsCalls).toHaveLength(1);
    expect(acsCalls[0]?.url).toBe('https://acs-aivera-dev.communication.azure.com/emails:send?api-version=2023-03-31');
    expect(acsCalls[0]?.headers['operation-id']).toBe(messageId);
    expect(acsCalls[0]?.body).toMatchObject({
      senderAddress: 'DoNotReply@credalent.example',
      recipients: { to: [{ address: SARA }] },
      content: { subject: 'A request about your application: Senior AI Engineer' },
    });
  });

  it('a rolled-back action queues nothing', async () => {
    const before = await admin.execute(sql`select count(*)::int as n from notifications.message`);
    await expect(
      withWorkspace(app, W1, async (tx) => {
        await notifications().queueEmail({ tx, workspaceId: W1 }, evidenceRequest());
        throw new Error('confirm failed after queueing');
      }),
    ).rejects.toThrow('confirm failed after queueing');
    expect(await admin.execute(sql`select count(*)::int as n from notifications.message`)).toEqual(before);
  });

  it('a redelivered message is not sent twice, and a final ACS refusal marks the row failed', async () => {
    acsStatus = 400;
    const { messageId } = await confirm();
    expect(await relayAndConsume()).toEqual(['complete']);
    expect((await row(messageId))?.status).toBe('failed');
    expect(acsCalls).toHaveLength(1);
  });

  it('stores the address and bodies sealed, never in the clear', async () => {
    const { messageId } = await confirm();
    const stored = await row(messageId);
    expect(stored?.sealed).not.toContain('example.com');
    expect(stored?.sealed).not.toContain('Senior AI Engineer');
    expect(stored?.recipient_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Scenario: An email cannot be sent without a causing action', () => {
  // SAFETY: mutation check: removed the causedBy check in queueEmail -> this test failed (the row was written)
  it('refuses queueEmail with no causedBy, writing nothing', async () => {
    const before = await admin.execute(sql`select count(*)::int as n from notifications.message`);
    const { causedBy: _none, ...withoutCause } = evidenceRequest();
    const refused = confirm(withoutCause as QueueEmailInput<'evidence-request'>);
    await expect(refused).rejects.toBeInstanceOf(EmailError);
    await expect(refused).rejects.toThrow('Every email needs the action that caused it');
    expect(await admin.execute(sql`select count(*)::int as n from notifications.message`)).toEqual(before);
  });
});

describe('Scenario: Template data is validated', () => {
  it('refuses an evidence request without the job title, naming the field jobTitle', async () => {
    const { jobTitle: _missing, ...data } = evidenceRequest().data;
    const refused = confirm(evidenceRequest({ data: data as QueueEmailInput<'evidence-request'>['data'] }));
    await expect(refused).rejects.toMatchObject({ code: 'invalid_data', fields: ['jobTitle'] });
    await expect(refused).rejects.toThrow(/jobTitle/);
  });
});

describe('Scenario: Replies go to the recruiter', () => {
  it("sets the reply-to address to the sending recruiter's work email", async () => {
    await confirm();
    await relayAndConsume();
    expect(acsCalls[0]?.body['replyTo']).toEqual([{ address: LAYLA, displayName: 'Layla Haddad' }]);
  });
});

/** An ACS delivery report as Event Grid posts it; it names the recipient, as the real one does. */
const report = (messageId: string, status: string) => [
  {
    id: uuidv7(),
    eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
    subject: `sender/DoNotReply@credalent.example/message/${messageId}`,
    eventTime: NOW.toISOString(),
    dataVersion: '1.0',
    data: { sender: 'DoNotReply@credalent.example', recipient: SARA, messageId, status },
  },
];

describe('Scenario: A bounce is recorded', () => {
  it('marks the row bounced when ACS reports a hard bounce', async () => {
    const { messageId } = await confirm();
    await relayAndConsume();
    const providerId = (await row(messageId))?.provider_message_id ?? '';
    expect(await handleEventGrid(app, report(providerId, 'Bounced'))).toEqual({ updated: 1 });
    expect((await row(messageId))?.status).toBe('bounced');
    // Repeated: nothing more changes.
    expect(await handleEventGrid(app, report(providerId, 'Bounced'))).toEqual({ updated: 0 });
  });

  it('leaves a delivered message sent, and answers the Event Grid handshake', async () => {
    const { messageId } = await confirm(evidenceRequest(), W2);
    await relayAndConsume();
    const providerId = (await row(messageId))?.provider_message_id ?? '';
    expect(await handleEventGrid(app, report(providerId, 'Delivered'))).toEqual({ updated: 0 });
    expect((await row(messageId))?.status).toBe('sent');
    expect(
      await handleEventGrid(app, [
        { eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent', data: { validationCode: 'code-1' } },
      ]),
    ).toEqual({ validationResponse: 'code-1' });
  });

  // SAFETY: mutation check: both delivery-report policies made `provider_message_id is not null` -> this test failed (read and updated W2's row too)
  it('naming one provider id reaches that row only, with no other filter', async () => {
    const a = await confirm();
    const b = await confirm(evidenceRequest(), W2);
    await relayAndConsume();
    const providerA = (await row(a.messageId))?.provider_message_id ?? '';
    const [read, updated] = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.provider_message_id', ${providerA}, true)`);
      return [
        await tx.execute<{ id: string }>(sql`select id from notifications.message`),
        await tx.execute<{ id: string }>(sql`update notifications.message set status = 'failed' returning id`),
      ];
    });
    expect([...read].map((r) => r.id)).toEqual([a.messageId]);
    expect([...updated].map((r) => r.id)).toEqual([a.messageId]);
    expect((await row(b.messageId))?.status).toBe('sent');
  });

  it('a report that arrives before the worker has recorded the send is refused, so Event Grid retries', async () => {
    await expect(handleEventGrid(app, report('acs-not-yet-recorded', 'Suppressed'))).rejects.toBeInstanceOf(
      ReportTooEarly,
    );
  });

  // SAFETY: mutation check: message_delivery_report_read made using (true) -> this test failed (W1 read W2's row)
  it('reaches only the named row: a workspace transaction still sees none of another workspace', async () => {
    const { messageId } = await confirm(evidenceRequest(), W2);
    await relayAndConsume();
    const seen = await withWorkspace(app, W1, (tx) =>
      tx.execute(sql`select id from notifications.message where id = ${messageId}`),
    );
    expect(seen).toHaveLength(0);
  });
});

describe('Scenario: Addresses never reach logs', () => {
  it('logs the recipient hash and never an address', async () => {
    const lines: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const { messageId } = await confirm();
      await relayAndConsume();
      const hash = (await row(messageId))?.recipient_hash ?? '';
      const sent = lines.find((line) => line.includes('"email sent"'));
      expect(sent).toContain(hash);
      expect(lines.join('')).not.toContain('@');
    } finally {
      write.mockRestore();
    }
  });
});
