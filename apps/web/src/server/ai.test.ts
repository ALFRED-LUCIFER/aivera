import { AiUnavailable, type AiClient } from '@credalent/ai';
import { describe, expect, it } from 'vitest';
import { aiOrUnavailable } from './ai';

// AIV-P1-033: an app with no AI configured must reach the explanation's template, not an error page.
describe('aiOrUnavailable', () => {
  const input = {} as Parameters<AiClient['generateStructured']>[0];

  // SAFETY: mutation check: removed the try/catch around get() -> this test failed (a plain Error escaped, no template)
  it('turns a construction error into AiUnavailable and never repeats its text', async () => {
    const ai = aiOrUnavailable('assessment.explainRanking', () => {
      throw new Error('Invalid configuration, missing or invalid: AZURE_OPENAI_RESOURCE_NAME');
    });
    const error = await Promise.resolve()
      .then(() => ai.generateStructured(input))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailable);
    expect((error as Error).message).not.toContain('AZURE');
  });

  it('calls the client when it builds', async () => {
    const ai = aiOrUnavailable('assessment.explainRanking', () => ({ generateStructured: async () => 'ok' }) as never);
    expect(await ai.generateStructured(input)).toBe('ok');
  });
});
