import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';

// Candidate personal data never leaves the process (AGENTS.md 1.2): every span, span event and log record passes
// through `redact` before an exporter sees it. Allowlist first: a key not listed below exports as "[redacted]".

export const REDACTED = '[redacted]';

// Keys the instrumentations and Aivera's own code emit without personal data. An entry ending in "." is a prefix.
const ALLOWED = [
  // OpenTelemetry semantic conventions (HTTP, URL, server, Next.js, Azure SDK, messaging, database metadata).
  'http.',
  'url.',
  'server.',
  'network.protocol.',
  'network.transport',
  'user_agent.',
  'next.',
  'otel.',
  'rpc.',
  'az.',
  'messaging.',
  'peer.service',
  'db.system',
  'db.operation',
  'db.namespace',
  'error.type',
  'exception.type',
  'exception.stacktrace',
  'exception.escaped',
  // The distro's own marker that standard metrics were counted; redacted, the backend would count requests twice.
  '_MS.',
  // pino's own fields, and the fields Aivera logs: message templates, areas, codes, error types.
  'level',
  'time',
  'pid',
  'hostname',
  'msg',
  'area',
  'code',
  'err.type',
  'err.stack',
];

// Opaque ids are allowed: `workspace.id`, `job_id`, `jobId`, `trace_id`.
const isId = (key: string) => /(^|[._])id$|[a-z0-9]Id$/.test(key);
const isAllowed = (key: string) =>
  isId(key) || ALLOWED.some((entry) => key === entry || (entry.endsWith('.') && key.startsWith(entry)));

// Words that redact a key even when the allowlist covers it (`http.request.header.cookie`, `http.client_ip`,
// `next.span_name`). Over-redacting costs a little debugging; under-redacting leaks a candidate.
const personalData = new Set([
  'email',
  'phone',
  'mobile',
  'name',
  'cv',
  'resume',
  'text',
  'prompt',
  'completion',
  'message',
  'messages',
  'content',
  'body',
  'note',
  'notes',
  'comment',
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'ip',
  // Bound query values (`drizzle.query.params`, postgres.js's `parameters` and `args`): the allowlist drops them
  // already; these words keep them out if a prefix that carries them is ever allowed.
  'params',
  'parameters',
  'args',
]);

/**
 * Adds field names a module stores personal data under, so they are redacted even where the allowlist would keep them
 * (an id-shaped `national_id`). Matched against the whole key, its dot segments and their camelCase/snake words.
 */
export function registerPersonalDataKeys(keys: readonly string[]): void {
  for (const key of keys) personalData.add(key.toLowerCase());
}

// "candidate.emailAddress" -> the whole key, candidate, emailaddress, email, address.
const words = (key: string) =>
  [key, ...key.split('.'), ...key.split(/[^a-zA-Z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)].map((word) => word.toLowerCase());

export const isPersonalDataKey = (key: string): boolean => words(key).some((word) => personalData.has(word));

// A URL or path anywhere in a string loses its query string and fragment: "GET /portal/r?token=abc" -> "GET /portal/r".
// shortcut: a relative path without a leading slash ("portal/r?x") keeps its query; none is emitted today, widen the pattern if one is
export const stripQuery = (value: string): string =>
  value.replace(/((?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#]*)[?#]\S*/gi, '$1');

// A stack trace starts with the error message; only the "    at ..." frames are kept.
const frames = (stack: string) =>
  stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');

function scrub(path: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => scrub(path, item));
  if (value !== null && typeof value === 'object') {
    redact(value as Record<string, unknown>, path);
    return value;
  }
  if (isPersonalDataKey(path) || !isAllowed(path)) return REDACTED;
  if (typeof value !== 'string') return value;
  return words(path).some((word) => word === 'stack' || word === 'stacktrace') ? frames(value) : stripQuery(value);
}

/** Redacts a record in place, judging each value by its full dotted path (`err.cause.detail`). */
export function redact(record: Record<string, unknown>, parent = ''): void {
  for (const [key, value] of Object.entries(record)) {
    const path = parent ? `${parent}.${key}` : key;
    // The exporter rebuilds a request URL from `url.path` + `url.query`; a redacted placeholder would still be appended.
    if (path === 'url.query') delete record[key];
    else record[key] = scrub(path, value);
  }
}

const done = async () => {};
// Names are read-only in the SDK's types but plain properties on the ended span; the exporter reads them as is.
const rename = (named: { name: string }) => ((named as { name: string }).name = stripQuery(named.name));

/** Runs before the exporting batch processor (the distro puts user processors in between). */
export const redactingSpanProcessor: SpanProcessor = {
  onStart: () => {},
  onEnd: (span: ReadableSpan) => {
    rename(span);
    redact(span.attributes as Record<string, unknown>);
    for (const event of span.events) {
      rename(event);
      if (event.attributes) redact(event.attributes as Record<string, unknown>);
    }
  },
  forceFlush: done,
  shutdown: done,
};

export const redactingLogRecordProcessor: LogRecordProcessor = {
  onEmit: (record: SdkLogRecord) => {
    redact(record.attributes as Record<string, unknown>);
    if (typeof record.body === 'string') record.body = stripQuery(record.body);
  },
  forceFlush: done,
  shutdown: done,
};
