// Azure AI Document Intelligence's layout model over REST (AIV-P1-025), signed in with the worker's managed identity:
// the AI resource has no keys (infra/modules/ai.bicep). Every answer is zod-checked (AGENTS.md 3.7). Errors carry a
// status only, never the document or the service's message, which can quote it (AGENTS.md 1.2).
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import {
  DocumentIntelligenceUnavailable,
  DocumentUnreadable,
  type DocumentIntelligencePort,
} from '../application/cvParse.ts';
import type { CvLayout } from '../domain/cv.ts';

export type DocumentIntelligenceConfig = {
  /** https://<resource>.cognitiveservices.azure.com (AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT). */
  endpoint: string;
  /** An Entra access token for https://cognitiveservices.azure.com/.default. */
  token: () => Promise<string>;
  /** Tests pass a no-op; between polls the worker waits the service's retry-after, else 1 s. */
  wait?: (ms: number) => Promise<void>;
};

const API_VERSION = '2024-11-30';
const REQUEST_TIMEOUT_MS = 30_000;
/** How long one analysis may run; a CV takes seconds. */
const ANALYSIS_DEADLINE_MS = 120_000;

const span = z.object({ offset: z.number().int().nonnegative(), length: z.number().int().nonnegative() });
const layoutSchema = z.object({
  content: z.string(),
  pages: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      unit: z.string().default(''),
      spans: z.array(span),
      lines: z
        .array(z.object({ content: z.string(), polygon: z.array(z.number()).default([]), spans: z.array(span) }))
        .default([]),
    }),
  ),
  styles: z
    .array(
      z.object({
        color: z
          .string()
          .nullish()
          .transform((v) => v ?? null),
        backgroundColor: z
          .string()
          .nullish()
          .transform((v) => v ?? null),
        spans: z.array(span),
      }),
    )
    .default([]),
}) satisfies z.ZodType<CvLayout>;
const errorSchema = z.object({
  error: z.object({ code: z.string().optional(), innererror: z.object({ code: z.string() }).optional() }),
});
const UNREADABLE = new Set([
  'InvalidContent',
  'UnsupportedContent',
  'InvalidContentLength',
  'InvalidContentDimensions',
]);
const operationSchema = z.object({
  status: z.enum(['notStarted', 'running', 'succeeded', 'failed', 'canceled', 'skipped']),
  analyzeResult: layoutSchema.optional(),
  error: z.object({ code: z.string(), innererror: z.object({ code: z.string() }).optional() }).optional(),
});

/** One request; a timeout, a 429 or a 5xx is DocumentIntelligenceUnavailable, a 400 DocumentUnreadable. */
async function call(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new DocumentIntelligenceUnavailable('timeout');
    throw new DocumentIntelligenceUnavailable('network');
  }
  if (response.ok) return response;
  if (response.status === 429 || response.status >= 500)
    throw new DocumentIntelligenceUnavailable(`http ${response.status}`);
  // Only the document's own fault is an unreadable CV; any other 400 (a wrong api-version, a feature missing in the
  // region) is ours and must retry and dead-letter, never mark every CV unreadable.
  const code = errorSchema.safeParse(await response.json().catch(() => null)).data?.error;
  if ([code?.code, code?.innererror?.code].some((c) => c && UNREADABLE.has(c))) throw new DocumentUnreadable();
  throw new Error(`Document Intelligence request failed with ${response.status}`);
}

export function createDocumentIntelligence(config: DocumentIntelligenceConfig): DocumentIntelligencePort {
  const base = new URL(config.endpoint);
  const wait = config.wait ?? ((ms: number) => sleep(ms));
  return {
    async analyze(data) {
      const token = await config.token();
      const analyze = new URL('/documentintelligence/documentModels/prebuilt-layout:analyze', base);
      analyze.search = new URLSearchParams({ 'api-version': API_VERSION, features: 'styleFont' }).toString();
      const started = await call(analyze.href, token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base64Source: data.toString('base64') }),
      });
      const location = started.headers.get('operation-location');
      // The token goes only to the configured endpoint, never to a host an answer names.
      if (!location || new URL(location).origin !== base.origin)
        throw new Error('Document Intelligence gave no result URL');
      const deadline = Date.now() + ANALYSIS_DEADLINE_MS;
      for (;;) {
        const polled = await call(location, token);
        const operation = operationSchema.parse(await polled.json());
        if (operation.status === 'succeeded' && operation.analyzeResult) return operation.analyzeResult;
        if (operation.status === 'failed') {
          const codes = [operation.error?.code, operation.error?.innererror?.code];
          throw codes.some((c) => c && UNREADABLE.has(c))
            ? new DocumentUnreadable()
            : new DocumentIntelligenceUnavailable('failed');
        }
        if (operation.status !== 'notStarted' && operation.status !== 'running')
          throw new DocumentIntelligenceUnavailable(operation.status);
        if (Date.now() > deadline) throw new DocumentIntelligenceUnavailable('timeout');
        await wait(Math.min(Number(polled.headers.get('retry-after')) * 1000 || 1000, 10_000));
      }
    },
  };
}
