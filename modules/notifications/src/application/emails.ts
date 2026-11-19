import type { Tx } from '@aivera/db';
import { z } from 'zod';
import {
  EmailError,
  senderSchema,
  TEMPLATES,
  type MessageStatus,
  type Sender,
  type TemplateData,
  type TemplateName,
} from '../domain/email.ts';

/** What is sealed on the row: everything personal the worker needs to send (AIV-P0-017). */
export type SealedEmail = { to: string; replyTo: Sender; subject: string; html: string; text: string };

export type QueueEmailInput<T extends TemplateName> = {
  template: T;
  to: string;
  data: TemplateData[T];
  /** The id of the human-confirmed action that caused the send (AGENTS.md 1.5). */
  causedBy: string;
  sender: Sender;
};

export type MessageRow = {
  id: string;
  workspaceId: string;
  template: string;
  recipientHash: string;
  sealed: string;
  status: MessageStatus;
  causedBy: string;
  createdAt: Date;
};

export type QueuePorts = {
  render<T extends TemplateName>(
    template: T,
    data: TemplateData[T],
    sender: Sender,
  ): Promise<{ subject: string; html: string; text: string }>;
  seal(value: SealedEmail): string;
  hash(email: string): string;
  insert(tx: Tx, row: MessageRow): Promise<void>;
  /** Writes EmailQueued.v1 to the outbox in `tx`. */
  publishQueued(tx: Tx, row: MessageRow): Promise<void>;
  newId(): string;
  now(): Date;
};

const email = z.email();
const causedBy = z.uuid();

/**
 * Validates, renders and seals the email, then writes the queued row and its outbox event in the caller's
 * transaction, so nothing is sent unless the confirmed action commits. Throws EmailError before writing.
 */
export async function queueEmail<T extends TemplateName>(
  ports: QueuePorts,
  ctx: { tx: Tx; workspaceId: string },
  input: QueueEmailInput<T>,
): Promise<{ messageId: string }> {
  // SAFETY: every email is caused by a person's confirmed action; nothing contacts a candidate on its own (AGENTS.md 1.5).
  if (!causedBy.safeParse(input.causedBy).success) throw new EmailError('no_cause');
  const schema = TEMPLATES[input.template];
  if (!schema) throw new EmailError('unknown_template');
  const data = schema.safeParse(input.data);
  if (!data.success)
    throw new EmailError('invalid_data', [...new Set(data.error.issues.map((issue) => issue.path.join('.')))]);
  const sender = senderSchema.safeParse(input.sender);
  if (!sender.success || !email.safeParse(input.to).success) throw new EmailError('invalid_address');

  const rendered = await ports.render(input.template, data.data as TemplateData[T], sender.data);
  const row: MessageRow = {
    id: ports.newId(),
    workspaceId: ctx.workspaceId,
    template: input.template,
    recipientHash: ports.hash(input.to),
    sealed: ports.seal({ to: input.to, replyTo: sender.data, ...rendered }),
    status: 'queued',
    causedBy: input.causedBy,
    createdAt: ports.now(),
  };
  await ports.insert(ctx.tx, row);
  await ports.publishQueued(ctx.tx, row);
  return { messageId: row.id };
}

/** ACS's answer to one send: accepted with its message id, or refused for good (400, 422; see acs.ts). */
export type SendResult = { accepted: true; providerMessageId: string } | { accepted: false };

export type SendPorts = {
  find(tx: Tx, id: string): Promise<MessageRow | undefined>;
  open(sealed: string): SealedEmail;
  /** Throws when a retry may help (network, 401, 403, 404, 429, 5xx), so the worker retries the message. */
  send(id: string, email: SealedEmail): Promise<SendResult>;
  mark(tx: Tx, id: string, change: { status: MessageStatus; providerMessageId?: string; sentAt?: Date }): Promise<void>;
  logSent(row: MessageRow, status: MessageStatus): void;
  now(): Date;
};

/** The worker's handler for EmailQueued.v1: sends a queued row once and records the outcome. */
export async function sendQueued(ports: SendPorts, tx: Tx, messageId: string): Promise<void> {
  const row = await ports.find(tx, messageId);
  if (!row || row.status !== 'queued') return;
  const result = await ports.send(row.id, ports.open(row.sealed));
  const status: MessageStatus = result.accepted ? 'sent' : 'failed';
  await ports.mark(
    tx,
    row.id,
    result.accepted ? { status, providerMessageId: result.providerMessageId, sentAt: ports.now() } : { status },
  );
  ports.logSent(row, status);
}
