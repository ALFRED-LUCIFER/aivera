import { LoggerProvider, InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { REDACTED, redactingLogRecordProcessor, redactingSpanProcessor, registerPersonalDataKeys } from './redact';

// Feature: Traces and metrics in Application Insights without personal data (AIV-P0-018). Synthetic data only.

// The distro's order: the redacting processor runs before the exporting one.
function exportSpan(attributes: Record<string, string>, exception?: Error, name = 'GET /portal/r') {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [redactingSpanProcessor, new SimpleSpanProcessor(exporter)],
  });
  const span = provider.getTracer('test').startSpan(name, { attributes });
  if (exception) span.recordException(exception);
  span.end();
  return exporter.getFinishedSpans()[0];
}

function exportLog(attributes: Record<string, string>, body = 'template') {
  const exporter = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({
    processors: [redactingLogRecordProcessor, new SimpleLogRecordProcessor({ exporter })],
  });
  provider.getLogger('test').emit({ body, attributes });
  return exporter.getFinishedLogRecords()[0];
}

// The fixture of synthetic personal data the redaction must catch.
const fixture = {
  'candidate.email': 'sara.candidate@example.test',
  phone: '+971 50 000 0000',
  prompt: 'Hi Sara, thank you...',
  'gen_ai.completion': 'Sara Al Qahtani led the eval harness',
  'candidate.displayName': 'Sara Al Qahtani',
  cvText: 'Senior AI Engineer, eval harness, merchant assistant',
  'interview.notes': 'Strong on evaluation design',
};
const PERSONAL = /sara|example\.test|\+971|eval harness|evaluation design/i;

describe('Scenario Outline: Personal data is redacted', () => {
  // SAFETY: mutation check: removed redact(span.attributes) from onEnd -> the span cases and the unlisted, deny-word, registered-key and URL tests failed
  it.each([
    ['candidate.email', 'sara.candidate@example.test', REDACTED],
    ['phone', '+971 50 000 0000', REDACTED],
    ['prompt', 'Hi Sara, thank you...', REDACTED],
    ['workspace.id', '4f1c2d9e-0000-7000-8000-000000000001', '4f1c2d9e-0000-7000-8000-000000000001'],
  ])('span attribute %s exports as the expected value', (field, value, exported) => {
    expect(exportSpan({ [field]: value })?.attributes[field]).toBe(exported);
  });

  // SAFETY: mutation check: removed redact(record.attributes) from onEmit -> the candidate.email log case and the fixture test failed
  it.each([
    ['candidate.email', 'sara.candidate@example.test', REDACTED],
    ['workspace.id', '4f1c', '4f1c'],
  ])('log attribute %s exports as the expected value', (field, value, exported) => {
    expect(exportLog({ [field]: value })?.attributes[field]).toBe(exported);
  });

  it('no value of the synthetic personal-data fixture is exported', () => {
    expect(JSON.stringify(exportSpan(fixture)?.attributes)).not.toMatch(PERSONAL);
    expect(JSON.stringify(exportLog(fixture)?.attributes)).not.toMatch(PERSONAL);
  });

  // Allowlist (AGENTS.md 1.2): a key nobody listed is redacted, whatever its name or type.
  // SAFETY: mutation check: removed `|| !isAllowed(path)` from scrub -> all four unlisted-key cases failed
  it.each([
    ['assessment.score', 68],
    ['candidate.headline', 'AI engineer in Dubai'],
    ['firstname', 'Sara'],
    ['employer', 'A BNPL fintech'],
  ])('an unlisted key %s is redacted', (field, value) => {
    expect(exportSpan({ [field]: value as string })?.attributes[field]).toBe(REDACTED);
  });

  it('listed semantic-convention keys keep their values', () => {
    const attributes = {
      'http.request.method': 'POST',
      'http.response.status_code': 500,
      'next.route': '/app/jobs',
      '_MS.ProcessedByMetricExtractors': "(Name:'Requests', Ver:'1.1')",
    };
    expect(exportSpan(attributes as unknown as Record<string, string>)?.attributes).toEqual(attributes);
  });

  it('AI call telemetry keeps its values, and any other AI key is redacted', () => {
    const attributes = {
      'aivera.ai.operation': 'chat',
      'aivera.ai.task': 'jobs.draftCompetencies',
      'aivera.ai.deployment': 'gpt-main',
      'aivera.ai.outcome': 'ok',
      'aivera.ai.attempts': 3,
      'aivera.ai.cost_usd_micros': 41,
      'aivera.ai.template_version': 'jobs.draftCompetencies@1+citations@1',
      'gen_ai.usage.input_tokens': 90,
      'gen_ai.usage.output_tokens': 4,
    };
    const leaky = { 'aivera.ai.prompt': 'Sara Al Qahtani', 'gen_ai.completion': 'Sara Al Qahtani' };
    expect(exportSpan({ ...attributes, ...leaky } as unknown as Record<string, string>)?.attributes).toEqual({
      ...attributes,
      'aivera.ai.prompt': REDACTED,
      'gen_ai.completion': REDACTED,
    });
  });

  // SAFETY: mutation check: allowed any value under an id key (dropped the OPAQUE test) -> this test failed
  it.each([
    ['enduser.id', 'sara.candidate@example.test'],
    ['user.id', 'Sara Al Qahtani'],
    ['candidate.githubId', 'sara-alq'],
  ])('an id key %s with a non-opaque value is redacted', (field, value) => {
    expect(exportSpan({ [field]: value })?.attributes[field]).toBe(REDACTED);
  });

  it('client addresses are dropped, so the exporter sends no placeholder as a location', () => {
    const attributes = exportSpan({ 'client.address': '192.0.2.10', 'http.client_ip': '192.0.2.10' })?.attributes;
    expect(attributes).not.toHaveProperty('client.address');
    expect(attributes).not.toHaveProperty('http.client_ip');
  });

  // SAFETY: mutation check: removed 'email' from the deny-list -> this test failed
  it.each([
    ['http.request.header.x-candidate-email', 'sara.candidate@example.test'],
    ['drizzle.query.params', '["sara.candidate@example.test"]'],
    ['messaging.message.body', 'Hi Sara'],
  ])('a deny-listed word redacts %s even under an allowed prefix', (field, value) => {
    expect(exportSpan({ [field]: value })?.attributes[field]).toBe(REDACTED);
  });

  // SAFETY: mutation check: removed the event-attribute redact from onEnd -> this test failed
  it("an exception's message is redacted and only its stack frames are kept", () => {
    const error = new Error('Failed query: params: sara.candidate@example.test');
    const [event] = exportSpan({}, error)?.events ?? [];
    expect(event?.attributes?.['exception.message']).toBe(REDACTED);
    expect(event?.attributes?.['exception.type']).toBe('Error');
    expect(String(event?.attributes?.['exception.stacktrace'])).toMatch(/^\s+at /);
    expect(JSON.stringify(event)).not.toMatch(PERSONAL);
  });

  // An id-shaped key passes the allowlist; a module registers it when its value is personal data.
  it('a module can register its own personal-data field names', () => {
    const key = 'candidate.national_id';
    expect(exportSpan({ [key]: '784-0000-0000000-0' })?.attributes[key]).toBe('784-0000-0000000-0');
    registerPersonalDataKeys(['national_id']);
    expect(exportSpan({ [key]: '784-0000-0000000-0' })?.attributes[key]).toBe(REDACTED);
    // shortcut: the registered key stays for the rest of this file's tests; harmless, as no later test uses it
  });
});

describe('Scenario: URLs lose their query strings', () => {
  // SAFETY: mutation check: returned the value unchanged from stripQuery -> all three URL tests failed
  it('"/portal/r?token=abc" is exported as "/portal/r"', () => {
    const span = exportSpan({
      'http.target': '/portal/r?token=abc',
      'url.full': 'https://app.aivera.example/portal/r?token=abc#x',
      'url.path': '/portal/r',
      'url.query': 'token=abc',
    });
    expect(span?.attributes['http.target']).toBe('/portal/r');
    expect(span?.attributes['url.full']).toBe('https://app.aivera.example/portal/r');
    expect(span?.attributes).not.toHaveProperty('url.query');
    expect(JSON.stringify(span?.attributes)).not.toMatch(/abc/);
  });

  // SAFETY: mutation check: removed rename(span) from onEnd -> this test failed
  it('a span name loses its query string', () => {
    expect(exportSpan({}, undefined, 'GET /portal/r?token=abc')?.name).toBe('GET /portal/r');
  });

  it('a log body loses its query string', () => {
    expect(exportLog({}, '/portal/r?token=abc')?.body).toBe('/portal/r');
  });
});
