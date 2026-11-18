import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';

// Candidate personal data never leaves the process (AGENTS.md 1.2): every span, span event and log record passes
// through `redact` before an exporter sees it.

export const REDACTED = '[redacted]';

// Words that mark personal data, free text or a secret in an attribute or log key. Over-redacting (`db.name`,
// `code.function.name`) costs a little debugging; under-redacting leaks a candidate.
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
]);

/** Adds the field names a module stores personal data under (e.g. the candidates module's profile fields). */
export function registerPersonalDataKeys(keys: readonly string[]): void {
  for (const key of keys) personalData.add(key.toLowerCase());
}

// "candidate.emailAddress" -> candidate, emailaddress, email, address: whole segments and their camelCase/snake words.
const words = (key: string) =>
  [...key.split('.'), ...key.split(/[^a-zA-Z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)].map((word) => word.toLowerCase());

export const isPersonalDataKey = (key: string): boolean => words(key).some((word) => personalData.has(word));

// A URL or path followed by a query string or fragment: "/portal/r?token=abc" keeps "/portal/r".
const URL_WITH_QUERY = /^([a-z][a-z0-9+.-]*:\/\/[^\s?#]*|\/[^\s?#]*)[?#]/i;

export const stripQuery = (value: string): string => URL_WITH_QUERY.exec(value)?.[1] ?? value;

// A stack trace starts with the error message; only the "    at ..." frames are kept.
const frames = (stack: string) =>
  stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');

/** Redacts a record in place: personal-data keys, error messages, query strings; nested objects and arrays too. */
export function redact(record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    // The exporter rebuilds a request URL from `url.path` + `url.query`; a redacted placeholder would still be appended.
    if (key === 'url.query') delete record[key];
    else if (isPersonalDataKey(key)) record[key] = REDACTED;
    else if (typeof value === 'string')
      record[key] = words(key).some((word) => word === 'stack' || word === 'stacktrace')
        ? frames(value)
        : stripQuery(value);
    else if (value !== null && typeof value === 'object') redact(value as Record<string, unknown>);
  }
}

const done = async () => {};

/** Runs before the exporting batch processor (the distro puts user processors in between). */
export const redactingSpanProcessor: SpanProcessor = {
  onStart: () => {},
  onEnd: (span: ReadableSpan) => {
    redact(span.attributes as Record<string, unknown>);
    for (const event of span.events) if (event.attributes) redact(event.attributes as Record<string, unknown>);
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
