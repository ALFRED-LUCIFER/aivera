import { LoggerProvider, InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { REDACTED, redactingLogRecordProcessor, redactingSpanProcessor, registerPersonalDataKeys } from './redact';

// Feature: Traces and metrics in Application Insights without personal data (AIV-P0-018). Synthetic data only.

// The distro's order: the redacting processor runs before the exporting one.
function exportSpan(attributes: Record<string, string>, exception?: Error) {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [redactingSpanProcessor, new SimpleSpanProcessor(exporter)],
  });
  const span = provider.getTracer('test').startSpan('GET /portal/r', { attributes });
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
  // SAFETY: mutation check: removed 'email' from the deny-list -> both candidate.email cases, the fixture test and the logger test failed
  // SAFETY: mutation check: removed redact(span.attributes) from onEnd -> the span cases, the fixture and URL tests failed
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

  // SAFETY: mutation check: removed the event loop from onEnd -> this test failed
  it("an exception's message is redacted and only its stack frames are kept", () => {
    const error = new Error('Failed query: params: sara.candidate@example.test');
    const [event] = exportSpan({}, error)?.events ?? [];
    expect(event?.attributes?.['exception.message']).toBe(REDACTED);
    expect(event?.attributes?.['exception.type']).toBe('Error');
    expect(String(event?.attributes?.['exception.stacktrace'])).toMatch(/^\s+at /);
    expect(JSON.stringify(event)).not.toMatch(PERSONAL);
  });

  it('a module can register its own personal-data field names', () => {
    expect(exportSpan({ 'candidate.headline': 'AI engineer in Dubai' })?.attributes['candidate.headline']).toBe(
      'AI engineer in Dubai',
    );
    registerPersonalDataKeys(['headline']);
    expect(exportSpan({ 'candidate.headline': 'AI engineer in Dubai' })?.attributes['candidate.headline']).toBe(
      REDACTED,
    );
  });
});

describe('Scenario: URLs lose their query strings', () => {
  // SAFETY: mutation check: returned the value unchanged from stripQuery -> both URL tests failed
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

  it('a log body loses its query string', () => {
    expect(exportLog({}, '/portal/r?token=abc')?.body).toBe('/portal/r');
  });
});
