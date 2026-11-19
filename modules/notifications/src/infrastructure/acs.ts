import { z } from 'zod';
import type { SealedEmail, SendResult } from '../application/emails.ts';

// Azure Communication Services Email over its REST API with the worker's managed identity (no SDK: one POST).
// https://learn.microsoft.com/rest/api/communication/dataplane/email/send

export type AcsConfig = {
  /** `https://<resource>.communication.azure.com` (ACS_ENDPOINT). */
  endpoint: string;
  /** The verified-domain sender, `DoNotReply@<domain>` (EMAIL_SENDER). */
  senderAddress: string;
  /** An Entra token for `https://communication.azure.com/.default`. */
  token(): Promise<string>;
  fetch?: typeof fetch;
};

const accepted = z.object({ id: z.string().min(1) });
const RETRY = new Set([401, 403, 404, 429]);

/**
 * Sends one email with `Operation-Id` = the send-log id. Throws when a retry may help (network, 401, 403, 404, 429,
 * 5xx: a misconfiguration then dead-letters and alerts instead of failing mail quietly); any other refusal (400, 422)
 * is final. Never puts a response body or address into an error.
 * shortcut: not verified that ACS refuses a repeated Operation-Id, so a worker crash between ACS accepting and the
 * commit can send the email twice; verify, or add ACS's repeatability headers, before the pilot (AIV-P5-E03, #34)
 */
export function createAcsSender(config: AcsConfig) {
  const post = config.fetch ?? fetch;
  return async function send(id: string, email: SealedEmail): Promise<SendResult> {
    const response = await post(`${config.endpoint}/emails:send?api-version=2023-03-31`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await config.token()}`,
        'content-type': 'application/json',
        'operation-id': id,
      },
      body: JSON.stringify({
        senderAddress: config.senderAddress,
        recipients: { to: [{ address: email.to }] },
        replyTo: [{ address: email.replyTo.email, displayName: email.replyTo.name }],
        content: { subject: email.subject, html: email.html, plainText: email.text },
        userEngagementTrackingDisabled: true,
      }),
    });
    if (RETRY.has(response.status) || response.status >= 500)
      throw new Error(`ACS email send failed with ${response.status}`);
    if (response.status !== 202) return { accepted: false };
    // Accepted either way; ACS's id is the operation id when it does not say otherwise.
    const body = accepted.safeParse(await response.json().catch(() => null));
    return { accepted: true, providerMessageId: body.success ? body.data.id : id };
  };
}
