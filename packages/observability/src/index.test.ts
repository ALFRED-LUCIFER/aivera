import { context, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { annotateSpan, log, withSpan } from './index.ts';

const spans = new InMemorySpanExporter();
const records = new InMemoryLogRecordExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }));
  logs.setGlobalLoggerProvider(
    new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: records })] }),
  );
});
afterAll(() => {
  trace.disable();
  logs.disable();
  context.disable();
});

describe('logger and spans share one correlation id', () => {
  // SAFETY: mutation check: removed redact(record) from the logger's write -> this test failed
  it('a log line inside a span carries its trace id, the workspace id, and no personal data', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await withSpan('action approveRubric', async () => {
      annotateSpan({ 'workspace.id': '0190d4a2-0000-7000-8000-000000000001' });
      log.info(
        { 'workspace.id': '0190d4a2-0000-7000-8000-000000000001', email: 'sara.candidate@example.test' },
        'rubric approved',
      );
    });
    const written = stdout.mock.calls.map(([chunk]) => String(chunk));
    stdout.mockRestore();

    const [span] = spans.getFinishedSpans();
    expect(span?.name).toBe('action approveRubric');
    expect(span?.attributes['workspace.id']).toBe('0190d4a2-0000-7000-8000-000000000001');

    const line = JSON.parse(written[0] ?? '') as Record<string, unknown>;
    expect(line).toMatchObject({
      msg: 'rubric approved',
      'workspace.id': '0190d4a2-0000-7000-8000-000000000001',
      trace_id: span?.spanContext().traceId,
    });
    expect(JSON.stringify(line)).not.toMatch(/example\.test/);

    const [record] = records.getFinishedLogRecords();
    expect(record?.spanContext?.traceId).toBe(span?.spanContext().traceId);
    expect(record?.severityText).toBe('info');
    expect(record?.severityNumber).toBe(9);
    expect(record?.attributes).toMatchObject({
      'workspace.id': '0190d4a2-0000-7000-8000-000000000001',
      email: '[redacted]',
    });
  });
});

const PERSONAL = /sara|example\.test|Al Qahtani/i;
function capture(write: () => void) {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  write();
  const lines = stdout.mock.calls.map(([chunk]) => String(chunk));
  stdout.mockRestore();
  return lines.join('');
}

// A database error wraps the postgres error, whose enumerable `detail` repeats the bound values.
const dbError = () =>
  new Error('insert failed for sara.candidate@example.test', {
    cause: Object.assign(new Error('duplicate key'), { detail: 'Key (email)=(sara.candidate@example.test) exists.' }),
  });

describe('the logger never exports an error message or a formatted value', () => {
  // SAFETY: mutation check: removed the `first instanceof Error` branch of hooks.logMethod -> this test failed (msg held the message)
  it.each([
    ['log.error(err)', () => log.error(dbError())],
    ['log.error({ err }, template)', () => log.error({ err: dbError() }, 'insert failed')],
  ])('%s keeps the error type and stack frames only', (_call, write) => {
    const out = capture(write);
    expect(out).not.toMatch(PERSONAL);
    expect(JSON.parse(out)).toMatchObject({ err: { type: 'Error' } });
    expect(JSON.parse(out).err.stack).toMatch(/^\s+at /);
  });

  // SAFETY: mutation check: passed every argument through hooks.logMethod -> this test failed (the email was formatted into msg)
  it('printf-style arguments are dropped, so msg stays the template', () => {
    const out = capture(() => log.info('invited %s', 'sara.candidate@example.test'));
    expect(JSON.parse(out).msg).toBe('invited %s');
  });
});
