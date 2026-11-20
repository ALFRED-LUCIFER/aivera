import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkOutput, cited, InvalidCitation, type Source } from './citations.ts';
import { createAiClient, memoryTokenBudget } from './client.ts';
import { CONTACT_EXTRACTION_TASKS, MissingIdentifiers, redactSources } from './identifiers.ts';
import { compareExcerptsRequest } from './prompts/evidence.compareExcerpts.ts';
import { mapToCompetencyRequest } from './prompts/evidence.mapToCompetency.ts';
import { parseCvRequest } from './prompts/evidence.parseCv.ts';
import { fakeProvider, type AiProvider } from './providers.ts';

// Feature: Candidate names and contact details never reach the model (AIV-P1-080, ADR-006 point 7). Synthetic data
// only (docs/00-product/personas.md).

const spans = new InMemorySpanExporter();
beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }));
});
afterAll(() => {
  trace.disable();
  context.disable();
});
beforeEach(() => spans.reset());

const sara = { names: ['Sara Al Qahtani'], emails: ['sara.al.qahtani@example.com'], phones: ['+44 7700 900123'] };
const source = (text: string, kind: Source['kind'] = 'document'): Source => ({ id: 'e1', kind, text });
const redact = (text: string, keep = false) => redactSources([source(text)], sara, keep).sources[0]?.text;
const workspaceId = '0190d4a2-0000-7000-8000-000000000001';
const leak = /sara|qahtani|900123/i;

describe('the replacer', () => {
  it.each([
    ["Sara's eval harness; Al Qahtani wrote the scorer.", '[CANDIDATE] eval harness; [CANDIDATE] wrote the scorer.'],
    ['SARA AL QAHTANI and sara al qahtani', '[CANDIDATE] and [CANDIDATE]'],
    ["Qahtani's and Qahtani’s notes", '[CANDIDATE] and [CANDIDATE] notes'],
    ['Sarah and Saratoga', 'Sarah and Saratoga'],
  ])('names: %s', (text, expected) => expect(redact(text)).toBe(expected));

  it('replaces the record email and any other email, numbered per call', () => {
    const { sources } = redactSources(
      [source('Mail sara.al.qahtani@example.com or omar@example.com.'), source('Again: Sara.Al.Qahtani@Example.com')],
      sara,
      false,
    );
    expect(sources.map((s) => s.text)).toEqual(['Mail [EMAIL_1] or [EMAIL_2].', 'Again: [EMAIL_1]']);
  });

  it.each([
    ['+44 7700 900123', '[PHONE_1]'],
    ['0044 7700 900123', '[PHONE_1]'],
    ['(+44) 7700-900-123', '[PHONE_1]'],
    ['07700 900123', '[PHONE_1]'],
    ['+971 50 000 0001', '[PHONE_1]'],
  ])('phones: %s', (text, expected) => expect(redact(`call ${text}.`)).toBe(`call ${expected}.`));

  it('numbers the same phone in two formats once, and leaves counts, years and dates alone', () => {
    expect(redact('+44 7700 900123, 0044-7700-900123, 07700 900123')).toBe('[PHONE_1], [PHONE_1], [PHONE_2]');
    const kept = 'about 9,000 merchants, 460 cases, 2019-2023, 2023-03-14, a 1234567 run';
    expect(redact(kept)).toBe(kept);
  });

  it('maps offsets back across shorter and longer placeholders', () => {
    const text = 'Al Qahtani: mail o@example.com. Sara built the merchant assistant.';
    const redaction = redactSources([source(text)], sara, false);
    const seen = redaction.sources[0]?.text ?? '';
    expect(seen).toBe('[CANDIDATE]: mail [EMAIL_1]. [CANDIDATE] built the merchant assistant.');
    const span = (quote: string) => {
      const start = seen.indexOf(quote);
      const { start: s, end: e } = redaction.original(0, { start, end: start + quote.length });
      return text.slice(s, e);
    };
    expect(span('[CANDIDATE] built the merchant assistant')).toBe('Sara built the merchant assistant');
    expect(span('built the merchant assistant')).toBe('built the merchant assistant');
    expect(span('mail [EMAIL_1]')).toBe('mail o@example.com');
    expect(span('CANDIDATE]: mail')).toBe('Al Qahtani: mail');
  });

  it('keeps emails and phones as written only with keepContact, and only evidence.parseCv gets it', () => {
    const header = 'Sara Al Qahtani · sara.al.qahtani@example.com · +44 7700 900123 · Senior AI Engineer';
    const { sources, kept } = redactSources([source(header, 'cv')], sara, true);
    expect(sources[0]?.text).toBe('[CANDIDATE] · sara.al.qahtani@example.com · +44 7700 900123 · Senior AI Engineer');
    expect(kept).toEqual(['sara.al.qahtani@example.com', '+44 7700 900123']);
    expect(CONTACT_EXTRACTION_TASKS).toEqual(['evidence.parseCv']);
  });
});

/** A client whose model answers `outputs` in turn and records every request. */
function recording(...outputs: unknown[]) {
  const requests: string[] = [];
  const provider: AiProvider = {
    ...fakeProvider(),
    languageModel: () =>
      new MockLanguageModelV4({
        doGenerate: async ({ prompt }) => {
          requests.push(JSON.stringify(prompt));
          const text = JSON.stringify(outputs.shift() ?? {});
          return {
            content: [{ type: 'text', text }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 100, noCache: undefined, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 20, text: 20, reasoning: 0 },
            },
            warnings: [],
          };
        },
      }),
  };
  const budget = memoryTokenBudget();
  return { ai: createAiClient({ provider, budget }), requests, budget };
}

/** An answer citing S1 with `quote`. */
const answer = (quote: string) => JSON.stringify({ items: [{ citations: [{ sourceId: 'S1', quote }] }] });
const competencies = [{ id: 'c-eval', name: 'Retrieval and evaluation', evidenceExpected: 'An eval harness.' }];
const noLinks = { links: [], changes: [] };

describe('Feature: Candidate names and contact details never reach the model', () => {
  // SAFETY: mutation check: sent `sources` instead of the redacted sources in generateStructured -> this test failed
  it("Scenario: Sara's name in a write-up excerpt is sent as a placeholder", async () => {
    const { ai, requests } = recording(noLinks);
    const writeUp = source("Sara's eval harness replays 460 golden cases; Al Qahtani wrote the scorer.");
    await ai.generateStructured({
      ...mapToCompetencyRequest(competencies, [writeUp]),
      workspaceId,
      identifiers: sara,
    });
    expect(requests[0]).toContain('[CANDIDATE] eval harness replays 460 golden cases; [CANDIDATE] wrote the scorer.');
    expect(requests[0]).not.toMatch(/sara|qahtani/i);
  });

  // SAFETY: mutation check: added evidence.mapToCompetency to CONTACT_EXTRACTION_TASKS -> the email row failed
  it.each([
    ['evidence.mapToCompetency', 'sara.al.qahtani@example.com', '[EMAIL_1]'],
    ['evidence.mapToCompetency', '+44 7700 900123', '[PHONE_1]'],
    ['evidence.compareExcerpts', '07700 900123', '[PHONE_1]'],
    ['evidence.compareExcerpts', 'omar@example.com', '[EMAIL_1]'],
  ])('Scenario Outline: %s replaces %s with %s', async (task, written, placeholder) => {
    const { ai, requests } = recording({ links: [], changes: [], contradictions: [] });
    const readme = source(`Contact for this repository: ${written} (maintainer).`, 'repo');
    const other = { ...source('Thousands of merchants.', 'reference'), id: 'e2' };
    const request =
      task === 'evidence.mapToCompetency'
        ? mapToCompetencyRequest(competencies, [readme])
        : compareExcerptsRequest([readme, other], [['e1', 'e2']]);
    await ai.generateStructured({ ...request, workspaceId, identifiers: sara } as never);
    expect(requests[0]).toContain(`Contact for this repository: ${placeholder} (maintainer).`);
    expect(requests[0]).not.toContain(written);
  });

  describe('Scenario: A cited quote still verifies after replacement and highlights the original text', () => {
    const schema = z.object({ items: z.array(cited(z.object({}))) });
    const writeUp = source('Sara built the merchant assistant for about 9,000 merchants.');
    const redaction = redactSources([writeUp], sara, false);

    // SAFETY: mutation check: checkOutput returned the redacted span without redaction.original -> this test failed
    it('accepts the placeholder quote with offsets covering the stored text', () => {
      const out = checkOutput(
        'evidence.mapToCompetency',
        answer('[CANDIDATE] built the merchant assistant'),
        schema,
        [writeUp],
        undefined,
        redaction,
      );
      const [citation] = out.items[0]?.citations ?? [];
      expect(citation).toEqual({ sourceId: 'e1', quote: 'Sara built the merchant assistant', start: 0, end: 33 });
      expect(writeUp.text.slice(citation?.start, citation?.end)).toBe('Sara built the merchant assistant');
    });

    it('rejects a quote of the original value, which the model never saw', () => {
      expect(() =>
        checkOutput(
          'evidence.mapToCompetency',
          answer('Sara built the merchant assistant'),
          schema,
          [writeUp],
          undefined,
          redaction,
        ),
      ).toThrow(InvalidCitation);
    });
  });

  it('Scenario: No name or contact detail appears in the recorded span or error message', async () => {
    const cv = source('Sara Al Qahtani · sara.al.qahtani@example.com · +44 7700 900123\nLed the eval set.', 'cv');
    const { ai } = recording(
      noLinks,
      { contradictions: [] },
      // A statement repeating the CV's email is dropped and counted on the span, never quoted there.
      {
        contact: { emails: [], phones: [] },
        workHistory: [],
        skills: [],
        statements: [
          { text: 'sara.al.qahtani@example.com', citations: [{ sourceId: 'S1', quote: 'Led the eval set.' }] },
        ],
      },
    );
    await ai.generateStructured({ ...mapToCompetencyRequest(competencies, [cv]), workspaceId, identifiers: sara });
    await ai.generateStructured({ ...compareExcerptsRequest([cv], []), workspaceId, identifiers: sara });
    await ai.generateStructured({ ...parseCvRequest([cv]), workspaceId, identifiers: sara });
    const error = await ai
      .generateStructured({ ...mapToCompetencyRequest(competencies, [cv]), workspaceId })
      .catch((e: unknown) => e);
    const telemetry = spans
      .getFinishedSpans()
      .map((s) => ({ name: s.name, attributes: s.attributes, events: s.events }));
    expect(telemetry.length).toBeGreaterThan(0);
    expect(JSON.stringify(telemetry)).not.toMatch(leak);
    expect(JSON.stringify(telemetry)).not.toMatch(/\[(?:CANDIDATE|EMAIL_\d|PHONE_\d)\]/);
    expect((error as Error).message).not.toMatch(leak);
  });

  // SAFETY: mutation check: removed the kept contact check in checkOutput -> this test failed
  it('Scenario: CV parsing may send the candidate own email and phone, never the name', async () => {
    const cv = source(
      'Sara Al Qahtani · sara.al.qahtani@example.com · +44 7700 900123 · Senior AI Engineer\nSara Al Qahtani led the Gulf Arabic eval set.',
      'cv',
    );
    const contact = { emails: ['sara.al.qahtani@example.com'], phones: ['+44 7700 900123'] };
    const quote = [{ sourceId: 'S1', quote: '[CANDIDATE] led the Gulf Arabic eval set' }];
    const { ai, requests } = recording({
      contact,
      workHistory: [],
      skills: [],
      statements: [
        { text: 'Reach me at sara.al.qahtani@example.com', citations: quote },
        { text: '[CANDIDATE] led the Gulf Arabic eval set', citations: quote },
      ],
    });
    const out = await ai.generateStructured({ ...parseCvRequest([cv]), workspaceId, identifiers: sara });
    expect(requests[0]).toContain('[CANDIDATE] · sara.al.qahtani@example.com · +44 7700 900123');
    expect(requests[0]).not.toMatch(/sara al qahtani/i);
    expect(out.contact).toEqual(contact);
    expect(out.statements.map((s) => [s.text, s.claim, s.citations[0]?.quote])).toEqual([
      ['[CANDIDATE] led the Gulf Arabic eval set', true, 'Sara Al Qahtani led the Gulf Arabic eval set'],
    ]);
  });

  // SAFETY: mutation check: removed the MissingIdentifiers guard in generateStructured -> this test failed
  it('Scenario: An evidence prompt sent without identifiers fails closed', async () => {
    const { ai, requests, budget } = recording(noLinks);
    const writeUp = source('Sara built the merchant assistant.');
    await expect(
      ai.generateStructured({ ...mapToCompetencyRequest(competencies, [writeUp]), workspaceId }),
    ).rejects.toBeInstanceOf(MissingIdentifiers);
    expect(requests).toEqual([]);
    expect(await budget.spentToday(workspaceId, new Date().toISOString().slice(0, 10))).toMatchObject({ spent: 0 });
  });
});
