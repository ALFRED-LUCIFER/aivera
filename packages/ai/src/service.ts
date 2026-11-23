import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { APICallError } from 'ai';
import { z } from 'zod';
import { assistantAnswerSchema } from './prompts/assistant.answer.ts';

// The Python AI service's contract and its caller (AIV-P2-068, ADR-015). The service makes the model call only:
// redaction, the budget, the prompt text and the citation check stay in client.ts. The JSON Schema in
// apps/backend/ai-service/contract/ is generated from these zod schemas (`pnpm --filter @credalent/ai contract`) and
// the service's pydantic models from it; service.test.ts and the service's own test fail on any drift.

/** Each task the service serves, with the output schema it asks the model for (Azure strict mode). */
export const serviceTasks = { 'assistant.answer': assistantAnswerSchema } as const;
export type ServiceTask = keyof typeof serviceTasks;

/** What client.ts sends: the redacted, formatted prompt and the caps. Never an id that names a person. */
export const serviceRequest = z
  .object({
    promptVersion: z.string().regex(/^[a-z][\w.-]{0,63}@\d{1,4}$/),
    system: z.string().min(1),
    prompt: z.string().min(1),
    /** Input plus output tokens the call may spend: the workspace's remaining budget, at most the task's cap. */
    tokenCap: z.int().positive(),
    maxOutputTokens: z.int().positive(),
    temperature: z.number().min(0).max(2),
  })
  .strict();
export type ServiceRequest = z.infer<typeof serviceRequest>;

/** The model's raw output text, checked by client.ts like any answer, and the tokens every model call spent. */
export const serviceResponse = z
  .object({
    output: z.string(),
    usage: z.object({ inputTokens: z.int().nonnegative(), outputTokens: z.int().nonnegative() }).strict(),
  })
  .strict();
export type ServiceResponse = z.infer<typeof serviceResponse>;

/** The contract files, by path under apps/backend/ai-service/contract/. */
export const contractSchemas = (): Record<string, unknown> => ({
  'request.schema.json': z.toJSONSchema(serviceRequest),
  'response.schema.json': z.toJSONSchema(serviceResponse),
  ...Object.fromEntries(
    Object.entries(serviceTasks).map(([task, schema]) => [`tasks/${task}.schema.json`, z.toJSONSchema(schema)]),
  ),
});

/** Sends one task call; throws APICallError on an HTTP error so client.ts retries and breaks the circuit as for Azure. */
export type AiService = (task: ServiceTask, request: ServiceRequest, abortSignal: AbortSignal) => Promise<unknown>;

/**
 * The service at `url`, called with a managed-identity token for `audience` (the service's app registration). The
 * response body is never read on an error: it could repeat the prompt (AGENTS.md 1.2).
 */
export function aiService(options: {
  url: string;
  audience: string;
  credential?: TokenCredential;
  fetch?: typeof fetch;
}): AiService {
  const credential = options.credential ?? new DefaultAzureCredential();
  const send = options.fetch ?? fetch;
  return async (task, request, abortSignal) => {
    const token = await credential.getToken(`${options.audience}/.default`);
    if (!token) throw new Error('no token for the AI service');
    const url = `${options.url}/tasks/${task}`;
    const response = await send(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: abortSignal,
    });
    if (!response.ok)
      throw new APICallError({
        message: `ai service ${response.status}`,
        url,
        requestBodyValues: {},
        statusCode: response.status,
        responseHeaders: Object.fromEntries(response.headers),
        isRetryable: response.status === 429 || response.status >= 500,
      });
    return response.json();
  };
}

/** The service from `AI_SERVICE_URL` and `AI_SERVICE_AUDIENCE`, both or neither; undefined when neither is set. */
export function aiServiceFromEnv(env: Record<string, string | undefined>): AiService | undefined {
  const url = env['AI_SERVICE_URL'];
  const audience = env['AI_SERVICE_AUDIENCE'];
  if (!url && !audience) return undefined;
  if (!url || !audience) throw new Error('Invalid configuration: set AI_SERVICE_URL and AI_SERVICE_AUDIENCE together');
  return aiService({ url: url.replace(/\/$/, ''), audience });
}
