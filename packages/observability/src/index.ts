import { trace, type Attributes } from '@opentelemetry/api';
import { logs, type LogAttributes } from '@opentelemetry/api-logs';
import pino from 'pino';
import { redact } from './redact';

// Logging and tracing for web and worker (AIV-P0-018). `initTelemetry` (`@aivera/observability/init`) turns export to
// Application Insights on; without it these are local-only (stdout) and the spans are no-ops.
//
// Outbox and worker trace continuation (AIV-P0-014, AIV-P0-015): the outbox row stores the W3C `traceparent` of the
// active span as the envelope's `correlationId` (`propagation.inject`), and the relay and the worker handler start their
// spans with it as parent (`propagation.extract`), so one operation id runs from the server action to the worker.
// shortcut: the contract only; the outbox (#46) and worker (#47) tickets implement and test it.

export { registerPersonalDataKeys } from './redact';

/**
 * The structured logger (AGENTS.md 3.13): message templates and ids only. Every line is redacted, written to stdout
 * with the active trace and span ids, and emitted to OpenTelemetry (a no-op until `initTelemetry`).
 */
export const log = pino(
  {
    timestamp: pino.stdTimeFunctions.isoTime,
    hooks: {
      // `msg` must stay a fixed template: `log.error(err)` would copy the error's message into it, and printf-style
      // arguments (`log.info('for %s', email)`) would be formatted into it. An error goes under `err`, extras are dropped.
      logMethod(args, method) {
        const [first] = args;
        if (first instanceof Error) return method.call(this, { err: first }, 'error');
        return method.apply(this, args.slice(0, typeof first === 'string' ? 1 : 2) as Parameters<typeof method>);
      },
    },
    mixin: () => {
      const span = trace.getActiveSpan()?.spanContext();
      return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
    },
  },
  {
    write(line: string) {
      const record = JSON.parse(line) as Record<string, unknown>;
      redact(record);
      process.stdout.write(`${JSON.stringify(record)}\n`);
      // The OpenTelemetry record carries the trace context itself.
      const { level, msg, time: _time, trace_id: _trace, span_id: _span, ...attributes } = record;
      logs.getLogger('aivera').emit({
        // pino 10/20/30/40/50/60 -> OpenTelemetry TRACE 1, DEBUG 5, INFO 9, WARN 13, ERROR 17, FATAL 21.
        severityNumber: ((level as number) / 10) * 4 - 3,
        severityText: pino.levels.labels[level as number] ?? String(level),
        body: msg as string,
        attributes: attributes as LogAttributes,
      });
    },
  },
);

/**
 * Runs `fn` in a new active span. A thrown error is left to the request span Next.js or the worker records, so
 * `redirect()` and `forbidden()` (thrown by design) are not counted as failures here.
 */
export function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return trace.getTracer('aivera').startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } finally {
      span.end();
    }
  });
}

/** Adds opaque ids (`workspace.id`, never an email) to the active span. */
export const annotateSpan = (attributes: Attributes): void => void trace.getActiveSpan()?.setAttributes(attributes);
