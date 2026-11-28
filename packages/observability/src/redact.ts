import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';

// Candidate personal data never leaves the process (AGENTS.md 1.2): every span, span event and log record passes
// through `redact` before an exporter sees it. Allowlist first: a key not listed below exports as "[redacted]".

export const REDACTED = '[redacted]';

// Keys the instrumentations and Credalent's own code emit without personal data. An entry ending in "." is a prefix.
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
  // pino's own fields, and the fields Credalent logs: message templates, areas, codes, error types.
  'level',
  'time',
  'pid',
  'hostname',
  'msg',
  'area',
  'code',
  'err.type',
  'err.stack',
  // Per-call AI telemetry (packages/ai): exact keys, so nothing else under these prefixes passes (AIV-P0-027).
  'credalent.ai.operation',
  'credalent.ai.task',
  'credalent.ai.deployment',
  'credalent.ai.outcome',
  'credalent.ai.attempts',
  'credalent.ai.cost_usd_micros',
  // The prompt template's id and version, pattern-checked by the client (`jobs.draftCompetencies@1+citations@2+untrusted@1`); not
  // named prompt_*, which the personal-data words redact (AIV-P0-028).
  'credalent.ai.template_version',
  // Statements an extraction or mapping answer lost because their quote is not in their source (AIV-P1-156): a count.
  'credalent.ai.citation_failures',
  // Which schema rules a rejected answer broke (AIV-P1-082): `path:code` pairs, pattern-checked by packages/ai
  // citations.ts `schemaRules`; trusted only because of that check.
  'credalent.ai.schema_rules',
  // How alike two evidence sources' fingerprints are, 0..1, logged with their ids when a flag is raised (AIV-P1-071).
  'credalent.evidence.similarity',
  // "Unusual content in this source" notes found on one CV parse (AIV-P1-025): a count, never the notes.
  'credalent.evidence.unusual_count',
  // A GitHub profile expansion's end (AIV-P1-112): the repositories queued and the outcome word, never a name or a login.
  'credalent.evidence.profile_queued',
  'credalent.evidence.profile_outcome',
  // Evidence mapping counts per run (AIV-P1-027): numbers only, so guard failures show in telemetry.
  'credalent.evidence.links',
  'credalent.evidence.gaps',
  'credalent.evidence.uncited_changes',
  // Links the citation contract dropped from the run's answer (AIV-P1-156): a count, never the quote.
  'credalent.evidence.uncited_links',
  // Contradictions the numeric pre-check found in the run (AIV-P1-029).
  'credalent.evidence.contradictions',
  // Pairs sent to the AI comparison, flagged by it, and left uncompared by a rejected answer (AIV-P1-078).
  'credalent.evidence.compared.sent',
  'credalent.evidence.compared.flagged',
  'credalent.evidence.compared.rejected',
  'credalent.evidence.discarded.unknown_competency',
  'credalent.evidence.discarded.unknown_source',
  'credalent.evidence.discarded.claim_above_supporting',
  'credalent.evidence.discarded.no_evidence_grade',
  // A catalogue eval run's end (AIV-P2-048): the version, tokens and failed case count; never a golden case.
  'credalent.catalogue.version',
  'credalent.catalogue.eval_tokens',
  'credalent.catalogue.eval_failed_cases',
  // How many applicants a job's Candidates tab listed (AIV-P1-086): a count, never a name.
  'credalent.intake.applications',
  // How many people one confirmed choice moved to interview (AIV-P1-114): a count, never a name.
  'credalent.intake.chosen',
  // How many of them the job's ranking listed as assessed (AIV-P1-034): a count, never a score.
  'credalent.assessment.ranked',
  // How many jobs and people a top-bar search found (AIV-P1-049): counts, never the query or a name.
  'credalent.search.jobs',
  'credalent.search.candidates',
  // Why a sign-in failed: the cause's class name and code (AIV-P0-930). Trusted only because apps/web auth.ts
  // pattern-checks both; any other code that emits these keys must check them the same way.
  'credalent.auth.cause',
  'credalent.auth.cause_code',
  // The HMAC of an email's recipient (AIV-P0-017): the only form of an address that may be logged.
  'notifications.recipient_hash',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
];

// Id keys (`workspace.id`, `job_id`, `jobId`, `trace_id`) keep only opaque values: hex and dashes, as UUIDv7 and trace
// ids are. `enduser.id: <an email>` or a GitHub handle under `githubId` is redacted.
const isId = (key: string) => /(^|[._])id$|[a-z0-9]Id$/.test(key);
const OPAQUE = /^[0-9a-f][0-9a-f-]{3,}$/i;
const isAllowed = (key: string) =>
  ALLOWED.some((entry) => key === entry || (entry.endsWith('.') && key.startsWith(entry)));

// Dropped, not replaced: the exporter builds URLs and the client location from these, and a placeholder would show
// up there (`ai.location.ip = "[redacted]"`, `?[redacted]` on a request URL).
const DROPPED = new Set(['url.query', 'client.address', 'http.client_ip', 'network.peer.address', 'net.peer.ip']);

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
  if (isPersonalDataKey(path)) return REDACTED;
  if (isId(path)) return typeof value === 'string' && OPAQUE.test(value) ? value : REDACTED;
  if (!isAllowed(path)) return REDACTED;
  if (typeof value !== 'string') return value;
  return words(path).some((word) => word === 'stack' || word === 'stacktrace') ? frames(value) : stripQuery(value);
}

/** Redacts a record in place, judging each value by its full dotted path (`err.cause.detail`). */
export function redact(record: Record<string, unknown>, parent = ''): void {
  for (const [key, value] of Object.entries(record)) {
    const path = parent ? `${parent}.${key}` : key;
    if (DROPPED.has(path)) delete record[key];
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
