import { newEnvelope } from '@credalent/db';
import type { ServiceBusReceivedMessage, ServiceBusReceiver, ServiceBusSender } from '@azure/service-bus';
import Long from 'long';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createScheduler, toDelivery } from './serviceBus.ts';

// AIV-P0-015: Service Bus faked at the SDK boundary (no emulator, see tests/integration/src/worker.test.ts).

const EvidenceFollowUp = { type: 'EvidenceFollowUpDue.v1', payload: z.strictObject({ requestId: z.uuid() }) };
const SENT_AT = new Date('2026-11-10T10:00:00.000Z');
const FOLLOW_UP_AT = new Date('2026-11-12T10:00:00.000Z');

describe('Scenario: A follow-up can be scheduled two days ahead', () => {
  it('schedules for 10:00 on 12 Nov and cancels by the returned sequence number', async () => {
    const sender = {
      scheduleMessages: vi.fn(async () => [Long.fromString('9007199254740993')]),
      cancelScheduledMessages: vi.fn(async () => {}),
    };
    const senderFor = vi.fn(() => sender as unknown as ServiceBusSender);
    const scheduler = createScheduler(senderFor);
    const envelope = newEnvelope(EvidenceFollowUp, {
      workspaceId: '0190d4a2-0000-7000-8000-000000000001',
      payload: { requestId: '0190d4a2-0000-7000-8000-0000000000e1' },
      occurredAt: SENT_AT,
    });

    const sequenceNumber = await scheduler.schedule('notifications', envelope, FOLLOW_UP_AT);
    expect(senderFor).toHaveBeenCalledWith('notifications');
    expect(sender.scheduleMessages).toHaveBeenCalledWith(
      { messageId: envelope.id, body: envelope, contentType: 'application/json', subject: 'EvidenceFollowUpDue.v1' },
      FOLLOW_UP_AT,
    );
    // Beyond 2^53: kept as a string so it round-trips exactly.
    expect(sequenceNumber).toBe('9007199254740993');

    await scheduler.cancel('notifications', sequenceNumber);
    expect(sender.cancelScheduledMessages).toHaveBeenCalledWith(Long.fromString('9007199254740993'));
  });

  it('refuses to schedule an envelope that is not valid', async () => {
    const sender = { scheduleMessages: vi.fn() };
    const scheduler = createScheduler(() => sender as unknown as ServiceBusSender);
    const bad = {
      ...newEnvelope(EvidenceFollowUp, {
        workspaceId: '0190d4a2-0000-7000-8000-000000000001',
        payload: { requestId: '0190d4a2-0000-7000-8000-0000000000e1' },
        occurredAt: SENT_AT,
      }),
      workspaceId: 'w1',
    };
    await expect(scheduler.schedule('notifications', bad, FOLLOW_UP_AT)).rejects.toThrow();
    expect(sender.scheduleMessages).not.toHaveBeenCalled();
  });
});

describe('toDelivery', () => {
  it('counts the first delivery as 1 and settles on the receiver with a fixed dead-letter reason', async () => {
    const receiver = {
      completeMessage: vi.fn(async () => {}),
      abandonMessage: vi.fn(async () => {}),
      deadLetterMessage: vi.fn(async () => {}),
    };
    const message = { body: { id: 'x' }, deliveryCount: 0 } as unknown as ServiceBusReceivedMessage;
    const delivery = toDelivery(receiver as unknown as ServiceBusReceiver, message);
    expect(delivery.deliveryCount).toBe(1);
    await delivery.complete();
    await delivery.abandon();
    await delivery.deadLetter('invalid payload');
    expect(receiver.completeMessage).toHaveBeenCalledWith(message);
    expect(receiver.abandonMessage).toHaveBeenCalledWith(message);
    expect(receiver.deadLetterMessage).toHaveBeenCalledWith(message, {
      deadLetterReason: 'invalid payload',
      deadLetterErrorDescription: 'invalid payload',
    });
  });
});
