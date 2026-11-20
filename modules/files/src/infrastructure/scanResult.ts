import { z } from 'zod';
import { parseQuarantineUrl, type Owner } from '../domain/files.ts';
import type { ScanVerdict } from '../application/files.ts';

// Defender for Storage's scan result, as Event Grid delivers it to the Service Bus queue (EventGridSchema). Only the
// fields used are read; nothing of it is logged.
const scanResult = z.object({
  eventType: z.literal('Microsoft.Security.MalwareScanningResult'),
  data: z.object({
    blobUri: z.url({ protocol: /^https?$/ }),
    scanResultType: z.string(),
  }),
});

const VERDICTS: Record<string, ScanVerdict> = { 'No threats found': 'clean', Malicious: 'infected' };

/** Service Bus hands Event Grid's body over as bytes or as parsed JSON. */
const json = (body: unknown): unknown =>
  typeof body === 'string'
    ? JSON.parse(body)
    : body instanceof Uint8Array
      ? JSON.parse(Buffer.from(body).toString('utf8'))
      : body;

/**
 * The file and verdict a scan result names; null for a blob outside quarantine (Defender also scans the moved copy in
 * cvs or evidence: nothing to do). Throws ZodError on any other body, and a plain Error on a result that is neither
 * verdict (such as "Error"), so it is retried and then dead-lettered for a person.
 */
export function parseScanResult(
  body: unknown,
): { target: { owner: Owner; fileId: string }; verdict: ScanVerdict } | null {
  const { data } = scanResult.parse(json(body));
  const target = parseQuarantineUrl(data.blobUri);
  if (!target) return null;
  const verdict = VERDICTS[data.scanResultType];
  if (!verdict) throw new Error('scan result is neither clean nor malicious');
  return { target, verdict };
}
