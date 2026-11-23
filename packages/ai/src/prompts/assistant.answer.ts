import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// The assistant answers a recruiter's question from the page's sources (AIV-P2-068, the assistant of epic #23): the
// first task served by the Python AI service (ADR-015). The prompt stays here, versioned, so the eval set covers it;
// the service makes the model call. The assistant module (AIV-P2-028) gathers the sources and calls it.

/** Bump with any change to the system prompt, the prompt or the schema; it goes on telemetry and the eval results. */
export const ASSISTANT_ANSWER_VERSION = 'assistant.answer@1';

export const ASSISTANT_ANSWER_SYSTEM = [
  "You answer a recruiter's question about a job and its candidates for Credalent, a hiring tool. Answer in short",
  'statements, each citing the sources it rests on. Say only what the sources show; when they do not answer the',
  'question, return no statements. Never recommend rejecting, advancing or contacting a candidate, and never rank or',
  'judge a person on anything but the evidence of their work: a person decides.',
].join(' ');

export const assistantAnswerSchema = z.object({ statements: z.array(cited(z.object({ text: z.string().min(1) }))) });

/** The whole request but its workspace and identifiers. The question is the recruiter's; page text goes in `sources`. */
export const assistantAnswerRequest = (question: string, sources: readonly Source[]) => ({
  task: 'assistant.answer' as const,
  promptVersion: ASSISTANT_ANSWER_VERSION,
  system: ASSISTANT_ANSWER_SYSTEM,
  prompt: `Question: ${question}`,
  schema: assistantAnswerSchema,
  sources,
});
