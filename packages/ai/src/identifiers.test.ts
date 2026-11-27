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

  it('another named person (an interviewer, AIV-P1-115) becomes [PERSON], never [CANDIDATE]', () => {
    const withLina = { ...sara, others: ['Lina Panel'] };
    const [sent] = redactSources(
      [source("Lina asked Sara about Panel's question; Sara answered.")],
      withLina,
      false,
    ).sources;
    expect(sent?.text).toBe('[PERSON] asked [CANDIDATE] about [PERSON] question; [CANDIDATE] answered.');
  });

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
    ['+971.50.123.4567', '[PHONE_1]'],
    ['050.123.4567', '[PHONE_1]'],
  ])('phones: %s', (text, expected) => expect(redact(`call ${text}.`)).toBe(`call ${expected}.`));

  it('numbers each written number once, and leaves counts, years, dates, decimals and metric lists alone', () => {
    expect(redact('+44 7700 900123, 0044-7700-900123, 07700 900123')).toBe('[PHONE_1], [PHONE_1], [PHONE_2]');
    expect(redact('call +44 - 7700 - 900123 today')).toBe('call [PHONE_1] today');
    const numbers = [
      'about 9,000 merchants, 460 cases, 2019-2023, 2023-03-14, a 1234567 run',
      'Jun 2020 - Aug 2023, 06.2020-08.2023, 12.03.2024, 2020 2021 2022',
      'scores 0.82 0.91 0.77, accuracy 98.2 97.4 96.1, p95 120 340 560 ms',
    ].join('; ');
    expect(redact(numbers)).toBe(numbers);
  });

  it('replaces a particle only inside a run of name parts, and splits hyphenated names', () => {
    const hyphenated = { names: ['Sara Al-Qahtani'], emails: [], phones: [] };
    const text = 'Al-Qahtani and Qahtani built it in Al Ain; see /usr/bin.';
    expect(redactSources([source(text)], hyphenated, false).sources[0]?.text).toBe(
      '[CANDIDATE] and [CANDIDATE] built it in Al Ain; see /usr/bin.',
    );
    expect(redact("'Sara' and Sara Al Qahtani")).toBe("'[CANDIDATE]' and [CANDIDATE]");
  });

  // SAFETY: mutation check: mapped the whole quote back (no cut to the longest placeholder-free stretch) -> this test
  // failed ('Sara built the merchant assistant', 'mail o@example.com')
  it('maps offsets back across placeholders and never brings an identifier back (AIV-P2-080)', () => {
    const text = 'Al Qahtani: mail o@example.com. Sara built the merchant assistant.';
    const redaction = redactSources([source(text)], sara, false);
    const seen = redaction.sources[0]?.text ?? '';
    expect(seen).toBe('[CANDIDATE]: mail [EMAIL_1]. [CANDIDATE] built the merchant assistant.');
    const span = (quote: string) => {
      const start = seen.indexOf(quote);
      const mapped = redaction.original(0, { start, end: start + quote.length });
      return mapped && text.slice(mapped.start, mapped.end);
    };
    expect(span('[CANDIDATE] built the merchant assistant')).toBe('built the merchant assistant');
    expect(span('built the merchant assistant')).toBe('built the merchant assistant');
    expect(span('mail [EMAIL_1]')).toBe('mail');
    expect(span('CANDIDATE]: mail')).toBe('mail');
    expect(span('[CANDIDATE]: mail [EMAIL_1]')).toBe('mail');
    expect(span('[EMAIL_1]')).toBeUndefined();
    expect(span('mail [EMAIL')).toBe('mail');
  });

  // SAFETY: mutation check: rejected only an empty stretch (best.end === best.start) -> this test failed ('(')
  it('rejects a quote with no word left once its placeholders are cut away', () => {
    const text = "Sara Al Qahtani (sara.al.qahtani@example.com) built it; 'Sara' said so.";
    const redaction = redactSources([source(text)], sara, false);
    const seen = redaction.sources[0]?.text ?? '';
    const span = (quote: string) => {
      const start = seen.indexOf(quote);
      return redaction.original(0, { start, end: start + quote.length });
    };
    expect(seen).toBe("[CANDIDATE] ([EMAIL_1]) built it; '[CANDIDATE]' said so.");
    expect(span('[CANDIDATE] ([EMAIL_1])')).toBeUndefined();
    expect(span("'[CANDIDATE]'")).toBeUndefined();
    expect(span('[CANDIDATE]')).toBeUndefined();
  });

  it('keeps the longest stretch of a quote with a placeholder inside it', () => {
    const text = "Sara's eval harness replays 460 golden cases; Al Qahtani wrote the scorer.";
    const redaction = redactSources([source(text)], sara, false);
    const seen = redaction.sources[0]?.text ?? '';
    const mapped = redaction.original(0, { start: 0, end: seen.length });
    expect(mapped && text.slice(mapped.start, mapped.end)).toBe('eval harness replays 460 golden cases');
  });

  it('keeps emails and phones as written only with keepContact, and only evidence.parseCv gets it', () => {
    const header = 'Sara Al Qahtani · sara.al.qahtani@example.com · +44 7700 900123 · Senior AI Engineer';
    const { sources } = redactSources([source(header, 'cv')], sara, true);
    expect(sources[0]?.text).toBe('[CANDIDATE] · sara.al.qahtani@example.com · +44 7700 900123 · Senior AI Engineer');
    expect(CONTACT_EXTRACTION_TASKS).toEqual(['evidence.parseCv']);
  });

  // SAFETY: mutation check: matched names on the unmasked text (no email masking) -> this test failed
  // ("[CANDIDATE].alqahtani@example.com" on every separator)
  it.each(['\n', ' ', ' - ', '\t', ' · '])(
    'never lets a name eat the email after it (separator %j, AIV-P2-081)',
    (separator) => {
      const cv = `Sara Al Qahtani${separator}sara.alqahtani@example.com`;
      expect(redactSources([source(cv, 'cv')], sara, true).sources[0]?.text).toBe(
        `[CANDIDATE]${separator}sara.alqahtani@example.com`,
      );
      expect(redactSources([source(cv, 'cv')], sara, false).sources[0]?.text).toBe(`[CANDIDATE]${separator}[EMAIL_1]`);
    },
  );

  // SAFETY: mutation check: let an email domain go without a dot ((?:\.[\w-]+)*) -> this test failed ("Qahtani@Acme")
  it('still replaces a name next to an "@" that is not an email', () => {
    expect(redact('Sara Al Qahtani@Acme')).toBe('[CANDIDATE]@Acme');
    expect(redact('Sara Al Qahtani\nsara@localhost')).toBe('[CANDIDATE]@localhost');
    expect(redact('Ask Sara@acme')).toBe('Ask [CANDIDATE]@acme');
  });

  // SAFETY: mutation check: matched names on the unmasked text (no email masking) -> this test failed (the kept email)
  it('never sends a name that sits in an email beside a phone (AIV-P2-081)', () => {
    expect(redact('Call 050 123 4567-qahtani@example.com')).not.toMatch(/qahtani/i);
    expect(redact('Call +971 50 123 4567.sara.qahtani@example.com')).not.toMatch(/sara|qahtani/i);
    // Under the CV-parse exception the candidate's own email goes whole, so only masking keeps the name out of it.
    expect(redact('Sara Al Qahtani sara.qahtani@example.com', true)).toBe('[CANDIDATE] sara.qahtani@example.com');
  });

  // SAFETY: mutation check: masked every email with MASK (no NAMED_MASK) -> this test failed (Arabic name kept)
  it('removes an Arabic name line next to an email that holds the name (AIV-P2-081)', () => {
    for (const keep of [false, true]) {
      const above = 'Curriculum Vitae\nsara.alqahtani@example.com · +971 50 123 4567\nسارة القحطاني\nEngineer';
      const below = 'Engineer\nسارة القحطاني\nsara.alqahtani@example.com';
      for (const cv of [above, below])
        expect(redactSources([source(cv, 'cv')], sara, keep).sources[0]?.text, `${keep}`).not.toContain('سارة');
    }
  });

  // SAFETY: mutation check: an ASCII-only email local part ([\w.%+-]) again -> this test failed ("Zoë@acme.com" whole)
  it('treats a non-ASCII local part as an email, so the name never reaches the model inside it', () => {
    const zoe = { names: ['Zoë Müller'], emails: [], phones: [] };
    const text = 'Write to Zoë@acme.com or Müller@acme.com, or zoë.müller@example.com.';
    expect(redactSources([source(text)], zoe, false).sources[0]?.text).toBe(
      'Write to [EMAIL_1] or [EMAIL_2], or [EMAIL_3].',
    );
  });

  it('keeps a name split across lines or by a no-break space as one placeholder', () => {
    expect(redactSources([source('Sara Al\nQahtani led it', 'cv')], sara, false).sources[0]?.text).toBe(
      '[CANDIDATE] led it',
    );
    expect(redactSources([source('Sara Al Qahtani led it', 'cv')], sara, false).sources[0]?.text).toBe(
      '[CANDIDATE] led it',
    );
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
    it('accepts the placeholder quote with offsets on the stored text, the name cut away', () => {
      const out = checkOutput(
        'evidence.mapToCompetency',
        answer('[CANDIDATE] built the merchant assistant'),
        schema,
        [writeUp],
        undefined,
        redaction,
      );
      const [citation] = out.items[0]?.citations ?? [];
      expect(citation).toEqual({ sourceId: 'e1', quote: 'built the merchant assistant', start: 5, end: 33 });
      expect(writeUp.text.slice(citation?.start, citation?.end)).toBe('built the merchant assistant');
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
    // The statement repeating the email is the evidence module's to drop (cv.ts cvClaims); quotes come back as stored,
    // without the name (AIV-P2-080).
    expect(out.statements.map((s) => [s.text, s.claim, s.citations[0]?.quote])).toEqual([
      ['Reach me at sara.al.qahtani@example.com', true, 'led the Gulf Arabic eval set'],
      ['[CANDIDATE] led the Gulf Arabic eval set', true, 'led the Gulf Arabic eval set'],
    ]);
  });

  // SAFETY: mutation check: removed the MissingIdentifiers guard in generateStructured -> this test failed (it is also
  // what makes "Redaction cannot be skipped" hold for a caller that leaves identifiers out, AIV-P2-065)
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

// Feature: Protected traits never reach the model (AIV-P2-065, AGENTS.md 1.5). Synthetic people only.
describe('Feature: Protected traits never reach the model', () => {
  const layla = { names: ['Layla Haddad'], emails: [], phones: [] };
  const cvText = (text: string, kind: Source['kind'] = 'cv', names = layla.names) =>
    redactSources([source(text, kind)], { ...layla, names }, false).sources[0]?.text;
  const emptyParse = { contact: { emails: [], phones: [] }, workHistory: [], skills: [], statements: [] };
  const traits =
    'ليلى حداد\nNationality: Egyptian · Date of birth: 14 March 1990 · Marital status: Married\nLed the OCR work.';

  // SAFETY: mutation check: dropped the `(?<trait>...)` alternative from patternFor -> every row of this outline failed
  it.each([
    ['Nationality: Indian', 'Indian'],
    ['Date of birth: 14 March 1990', '1990'],
    ['Marital status: Married', 'Married'],
    ['Gender: Female', 'Female'],
    ['الجنسية: مصري', 'مصري'],
  ])('Scenario Outline: the labelled line "%s" is removed', async (line, value) => {
    const { ai, requests } = recording(emptyParse);
    const cv = source(`Layla Haddad\n${line}\nBuilt an Arabic OCR pipeline in Python.`, 'cv');
    await ai.generateStructured({ ...parseCvRequest([cv]), workspaceId, identifiers: layla });
    expect(requests[0]).toContain('[CANDIDATE]\\n[REMOVED]\\nBuilt an Arabic OCR pipeline in Python.');
    expect(requests[0]).not.toContain(value);
  });

  // SAFETY: mutation check: dropped NEXT_LINE from the labelled-trait alternative -> the four bare-label rows failed;
  // dropped its Photo lookbehind -> the "Photo:\nBuilt payment APIs" row failed; dropped its \r? -> the "\r\n" row failed
  it.each([
    ['Nationality: Egyptian · Skills: Python', '[REMOVED] · Skills: Python'],
    ['Citizenship: Jordanian', '[REMOVED]'],
    ['DATE OF BIRTH: 14/03/1990 | Dubai', '[REMOVED] | Dubai'],
    ['DOB: 1990-03-14', '[REMOVED]'],
    ['D.O.B.: 14.03.1990', '[REMOVED]'],
    ['Birth date: 14 March 1990', '[REMOVED]'],
    ['Place of birth: Cairo', '[REMOVED]'],
    ['Born: 1990', '[REMOVED]'],
    ['Personal details: Age: 34, Sex: F', 'Personal details: [REMOVED], [REMOVED]'],
    [
      'Nationality: Egyptian, Date of birth: 14 March, 1990, Gender: Female, Skills: Python, Go',
      '[REMOVED], [REMOVED], [REMOVED], Skills: Python, Go',
    ],
    ['Nationality - Egyptian', '[REMOVED]'],
    ['DOB - 14/03/1990 · Dubai', '[REMOVED] · Dubai'],
    ['Gender – Female', '[REMOVED]'],
    ['Nationality\tEgyptian', '[REMOVED]'],
    ['Civil status: Single', '[REMOVED]'],
    ['Family status: Married, two children', '[REMOVED]'],
    ['Religion: Muslim', '[REMOVED]'],
    ['Photo: attached', '[REMOVED]'],
    ['Photograph:\nattached\nSkills: Go', '[REMOVED]\nSkills: Go'],
    ['Photo:\nBuilt payment APIs in Python', '[REMOVED]\nBuilt payment APIs in Python'],
    ['Nationality:\nEgyptian\nSkills: Go', '[REMOVED]\nSkills: Go'],
    ['Age:\n34', '[REMOVED]'],
    ['Nationality:\r\nEgyptian', '[REMOVED]'],
    ['Date of birth:\n14 March 1990 · Dubai', '[REMOVED] · Dubai'],
    ['الجنسية:\nمصرية', '[REMOVED]'],
    ['Nationality:\nSkills: Python', '[REMOVED]\nSkills: Python'],
    [
      'Gender:\nBuilt payment APIs in Python and Go for ten years',
      '[REMOVED]\nBuilt payment APIs in Python and Go for ten years',
    ],
    ['Nationality :Egyptian', '[REMOVED]'],
    ['تاريخ الميلاد: ١٤ مارس ١٩٩٠', '[REMOVED]'],
    ['مكان الميلاد: القاهرة', '[REMOVED]'],
    ['العمر: ٣٤', '[REMOVED]'],
    ['السن: 34', '[REMOVED]'],
    ['الحالة الاجتماعية: متزوجة · الجنس: أنثى', '[REMOVED] · [REMOVED]'],
    ['الديانة: مسلمة', '[REMOVED]'],
    ['الدين: مسلم', '[REMOVED]'],
    ['الصورة: مرفقة', '[REMOVED]'],
    ['I am 34 years old, a 34-year-old engineer, aged 34.', 'I am [REMOVED], a [REMOVED] engineer, [REMOVED].'],
    ['Backend Engineer [Photo attached] (photograph)', 'Backend Engineer [REMOVED] [REMOVED]'],
  ])('pattern: %s', (text, expected) => expect(cvText(text)).toBe(expected));

  // SAFETY: mutation check: dropped the `(?<arabicName>...)` alternative from patternFor -> every row failed; dropped
  // the two lines-next-to-the-record-name alternatives from arabicNameOf -> the "Layla Haddad\n..." and
  // "...\nLayla Haddad" rows failed; dropped the name-label alternative -> the two label rows failed;
  // dropped the optional line break after the name label -> the "Name:\n" row failed
  it.each([
    ['ليلى حداد\nSenior AI Engineer', '[CANDIDATE]\nSenior AI Engineer'],
    ['Layla Haddad · ليلى حداد · Dubai', '[CANDIDATE] · [CANDIDATE] · Dubai'],
    ['Layla Haddad\nليلى حداد\nSenior AI Engineer', '[CANDIDATE]\n[CANDIDATE]\nSenior AI Engineer'],
    ['Curriculum vitae\nليلى حداد\nLayla Haddad · Dubai', 'Curriculum vitae\n[CANDIDATE]\n[CANDIDATE] · Dubai'],
    ['Senior AI Engineer\nالاسم: ليلى حداد', 'Senior AI Engineer\nالاسم: [CANDIDATE]'],
    ['Senior AI Engineer\nName:\nليلى حداد\nDubai', 'Senior AI Engineer\nName:\n[CANDIDATE]\nDubai'],
    ['Senior AI Engineer\nFull name: ليلى حداد · Dubai', 'Senior AI Engineer\nFull name: [CANDIDATE] · Dubai'],
    ['\u200fليلى حداد\n\u200fالجنسية: مصرية', '\u200f[CANDIDATE]\n\u200f[REMOVED]'],
  ])('Scenario: An Arabic-script name on the CV name line is removed: %s', (text, expected) =>
    expect(cvText(text)).toBe(expected),
  );

  it('removes labelled traits from CV, document and reference sources only, never from code', () => {
    const code = 'type Candidate = {\n  age: number;\n};\nPhoto: Lightroom presets';
    expect(cvText(code, 'repo')).toBe(code);
    for (const kind of ['document', 'reference'] as const)
      expect(cvText('Nationality: Egyptian', kind)).toBe('[REMOVED]');
  });

  // SAFETY: mutation check: removed the trait-overlap check in redactSources `original` -> this test failed
  it('rejects a citation that touches removed trait text, so a trait never comes back as a stored quote', () => {
    const schema = z.object({ items: z.array(cited(z.object({}))) });
    const cv = source('Gender: Female\nBuilt an Arabic OCR pipeline in Python.', 'cv');
    const redaction = redactSources([cv], layla, false);
    const check = (quote: string) =>
      checkOutput('evidence.parseCv', answer(quote), schema, [cv], undefined, redaction).items[0]?.citations[0]?.quote;
    expect(check('Built an Arabic OCR pipeline')).toBe('Built an Arabic OCR pipeline');
    expect(() => check('[REMOVED]')).toThrow(InvalidCitation);
    expect(() => check('[REMOVED] Built an Arabic OCR')).toThrow(InvalidCitation);
  });

  // SAFETY: mutation check: dropped the letter boundaries from the name check in arabicNameOf -> both rows failed
  it.each([
    ['Quality assurance lead\nمهندس برمجيات أول', 'Ali Hassan'],
    ['Khalilov Systems\nمهندس برمجيات أول', 'Omar Khalil'],
  ])('keeps an Arabic job title next to a word that only contains a name part: %s', (text, name) =>
    expect(cvText(text, 'cv', [name])).toBe(text),
  );

  // SAFETY: mutation check: dropped the (?<!${LOCAL}) lookbehind from EMAIL -> this test timed out (quadratic scan)
  it('scans a long unbroken run once, so it finishes', () => {
    const run = 'a'.repeat(120_000);
    expect(cvText(run)).toBe(run);
    expect(cvText('Write to a+b@example.com', 'document')).toBe('Write to [EMAIL_1]');
  });

  // SAFETY: mutation check: put back a per-name-part email lookahead (${own}(?!${LOCAL}*@…)) -> this test took
  // seconds instead of milliseconds and failed its time limit (AIV-P2-081)
  it('redacts a long run of repeated name parts in linear time', () => {
    const arabic = 'ليلى-'.repeat(12_000);
    const started = performance.now();
    cvText(arabic, 'cv', ['ليلى حداد']);
    cvText('Layla.'.repeat(10_000), 'document');
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('Scenario: An Arabic-script name the record holds is removed anywhere, and a document title stays', () => {
    expect(cvText('Built it with ليلى حداد and Omar.', 'document', ['Layla Haddad', 'ليلى حداد'])).toBe(
      'Built it with [CANDIDATE] and Omar.',
    );
    expect(cvText('خط معالجة النصوص\nThe Arabic OCR pipeline.', 'document')).toBe(
      'خط معالجة النصوص\nThe Arabic OCR pipeline.',
    );
  });

  it('Scenario: Skills text is untouched', () => {
    const skills = [
      'Built payment APIs in Python',
      'Project name: Ledger; storage: 40 TB; Usage: 34 rps; message age: 2 s',
      'Skills: Python, sex-disaggregated metrics, photo editing, Gender bias evals',
      'Senior AI Engineer, A BNPL fintech, Jun 2020 - Aug 2023, 9,000 merchants, 99.95% uptime',
    ].join('\n');
    expect(cvText(skills)).toBe(skills);
  });

  // SAFETY: mutation check: matched a CV with the document pattern in redactSources `patternOf` -> every row failed on
  // the Arabic name line; dropped the trait alternative -> every row failed
  it.each([
    ['evidence.mapToCompetency', () => mapToCompetencyRequest(competencies, [source(traits, 'cv')]), noLinks],
    ['evidence.compareExcerpts', () => compareExcerptsRequest([source(traits, 'cv')], []), { contradictions: [] }],
    ['evidence.parseCv', () => parseCvRequest([source(traits, 'cv')]), emptyParse],
  ])('Scenario: Redaction cannot be skipped: %s', async (_task, request, output) => {
    const { ai, requests } = recording(output);
    await ai.generateStructured({ ...request(), workspaceId, identifiers: layla } as never);
    expect(requests[0]).toContain('[CANDIDATE]\\n[REMOVED] · [REMOVED] · [REMOVED]\\nLed the OCR work.');
    expect(requests[0]).not.toMatch(/ليلى|Egyptian|1990|Married/);
  });
});

// Feature: Identifiers and protected traits are found in a source whatever compatibility forms its letters use
// (AIV-P1-161, AGENTS.md 1.2). Synthetic. Illustrative: no cast name holds "fi" or "fl", so "ﬆ" (the st ligature)
// stands in for the ligatures PDF extraction emits most, U+FB01 and U+FB02.
describe('Feature: Identifiers and traits are found whatever compatibility forms the letters use', () => {
  const kristine = { names: ['Kristine Dela Cruz'], emails: ['kristine.delacruz@example.com'], phones: [] };
  const sent = (text: string, keepContact = false, record: typeof kristine = kristine) =>
    redactSources([source(text, 'cv')], record, keepContact).sources[0]?.text;
  const firstName = /Kristine|Kriﬆine|ＫＲＩＳＴＩＮＥ/i;

  // SAFETY: mutation check: matched on source.text unfolded in redactSources (the code before AIV-P1-161) -> the
  // three compatibility-form rows failed ("Kriﬆine [CANDIDATE]" was sent)
  it.each([
    ['Kriﬆine Dela Cruz', '[CANDIDATE]'],
    ['ＫＲＩＳＴＩＮＥ Dela Cruz', '[CANDIDATE]'],
    ["Kriﬆine Dela Cruz's checkout suite", '[CANDIDATE] checkout suite'],
    ['Kristine Dela Cruz', '[CANDIDATE]'],
  ])('Scenario: A name written with a compatibility form is replaced whole: %s', (written, expected) => {
    for (const keepContact of [false, true]) {
      expect(sent(written, keepContact)).toBe(expected);
      expect(sent(`${written}\nLed the checkout test suite.`, keepContact)).not.toMatch(firstName);
    }
  });

  // SAFETY: mutation check: left the record's names unfolded in redactSources -> this test failed
  it('a record that holds the compatibility form itself still matches the plain spelling, and the reverse', () => {
    const ligatureRecord = { ...kristine, names: ['Kriﬆine Dela Cruz'] };
    expect(sent('Kristine Dela Cruz and Kriﬆine', false, ligatureRecord)).toBe('[CANDIDATE] and [CANDIDATE]');
  });

  // SAFETY: mutation check: matched on source.text unfolded in redactSources -> this test failed ("[EMAIL_1] ·
  // [EMAIL_2]"); keyed the email placeholder on the source's own characters -> this test failed the same way
  it('Scenario: The same email written with and without a ligature gets one placeholder', () => {
    expect(sent('kriﬆine.delacruz@example.com · kristine.delacruz@example.com')).toBe('[EMAIL_1] · [EMAIL_1]');
  });

  // SAFETY: mutation check: matched on source.text unfolded in redactSources -> this test failed (the Arabic name
  // line stayed); sliced the redacted text from the folded text -> this test failed (the email lost its ligature)
  it('an email written with a ligature still marks its line as the name line, and is kept as written for parseCv', () => {
    const email = 'kriﬆine@example.com';
    expect(sent(`${email}\nكريستين ديلا كروز\nLed the checkout test suite.`, true)).toBe(
      `${email}\n[CANDIDATE]\nLed the checkout test suite.`,
    );
  });

  // SAFETY: mutation check: matched on source.text unfolded in redactSources -> the first two rows failed (the line
  // was sent as written)
  it.each(['Marital ﬆatus: Married', '𝐍𝐚𝐭𝐢𝐨𝐧𝐚𝐥𝐢𝐭𝐲: Filipino', 'Nationality: Filipino'])(
    'Scenario: A protected-trait field written with compatibility forms is removed: %s',
    (written) => {
      expect(sent(written, true)).toBe('[REMOVED]');
      expect(sent(`Led the checkout test suite.\n${written}\nPlaywright, k6`, true)).toBe(
        'Led the checkout test suite.\n[REMOVED]\nPlaywright, k6',
      );
    },
  );

  // SAFETY: mutation check: sliced the redacted text from the folded text in redactSources -> this test failed
  it('keeps every character that is not an identifier exactly as written', () => {
    const text = '𝐒𝐤𝐢𝐥𝐥𝐬: veriﬁed workﬂows, 10⁶ requests, ｋ６ · Kriﬆine · ① Playwright';
    expect(sent(text)).toBe(text.replace('Kriﬆine', '[CANDIDATE]'));
  });

  // SAFETY: mutation check: sliced the redacted text and the cuts from the folded text instead of the source in
  // redactSources -> this test failed (the stored quote and its offsets no longer matched the source)
  it('Scenario: Offsets still index the original text and a quote never brings the name back', () => {
    const schema = z.object({ items: z.array(cited(z.object({}))) });
    const work = 'Led the checkout test suite migration to Playwright';
    const cv = source(`𝐍𝐚𝐦𝐞: Kriﬆine Dela Cruz\n${work}`, 'cv');
    const redaction = redactSources([cv], kristine, false);
    expect(redaction.sources[0]?.text).toBe(`𝐍𝐚𝐦𝐞: [CANDIDATE]\n${work}`);
    const stored = (quote: string) =>
      checkOutput('evidence.mapToCompetency', answer(quote), schema, [cv], undefined, redaction).items[0]?.citations[0];
    const cited1 = stored(`[CANDIDATE] ${work}`);
    expect(cited1?.quote).toBe(work);
    expect(cv.text.slice(cited1?.start, cited1?.end)).toBe(work);
    // A quote of the heading in plain letters is the source's own characters, and stops before the name.
    const heading = stored('Name: [CANDIDATE]');
    expect(heading?.quote).toBe('𝐍𝐚𝐦𝐞');
    expect(cv.text.slice(heading?.start, heading?.end)).toBe('𝐍𝐚𝐦𝐞');
    expect(`${cited1?.quote} ${heading?.quote}`).not.toMatch(firstName);
  });

  it('Scenario: Nothing about the fold leaves the call', () => {
    const redaction = redactSources([source('Kriﬆine Dela Cruz', 'cv')], kristine, false);
    expect(Object.keys(redaction)).toEqual(['sources', 'original']);
    expect(redaction.sources).toEqual([{ id: 'e1', kind: 'cv', text: '[CANDIDATE]' }]);
  });
});
