import { z } from 'zod';
import type { Redaction } from './identifiers.ts';

// The citation contract (AIV-P0-028, ADR-006 points 3 to 5, AGENTS.md 1.6): the model sees numbered sources, every
// cited statement names the sources it rests on with a verbatim quote, and code, not the model, checks each quote and
// decides what is only a claim. Errors carry the task and a source label at most: never a quote, source text or the
// model's raw output (AGENTS.md 1.2).

export type SourceKind = 'cv' | 'repo' | 'document' | 'reference' | 'interview' | 'job_description';

/** One piece of text the model may cite. `id` is the caller's opaque id (an evidence id); it never reaches the model. */
export type Source = { id: string; kind: SourceKind; text: string; uri?: string };

// A statement citing the candidate's own account is a claim (zero in the backed score) unless a source about the
// candidate's work backs it too; the job description says nothing about the candidate, so it backs nothing.
// Here only `cv` sets `claim`: `document` stands for several evidence kinds, so evidence mapping decides per kind
// (modules/evidence/src/domain/mapping.ts, AIV-P1-087): a candidate-written source with no second, independent source
// is a claim, and every non-repository kind is capped below Strong.
const CANDIDATE_WORDS: ReadonlySet<SourceKind> = new Set(['cv']);
const BACKS_NOTHING: ReadonlySet<SourceKind> = new Set(['cv', 'job_description']);

// shortcut: any non-empty quote passes, so a one-word quote proves little; set a minimum if the eval set (AIV-P0-029)
// shows short quotes slipping through.
/** What the model returns for each citation: the source label it was shown (`S1`) and a quote from that source. */
export const citation = z.object({ sourceId: z.string(), quote: z.string().min(1) });

/** Makes an object schema a cited statement: the model must give at least one citation for it. */
export const cited = <T extends z.ZodRawShape>(item: z.ZodObject<T>) =>
  item.extend({ citations: z.array(citation).min(1) });

/** A checked citation: the caller's source id, the exact source text quoted, and its offsets for `EvidenceHighlight`. */
export type Citation = { sourceId: string; quote: string; start: number; end: number };

/** The model's output after the contract: every cited statement has checked citations and a `claim` flag set by code. */
export type Checked<T> = T extends { citations: unknown[] }
  ? { [K in keyof T]: K extends 'citations' ? Citation[] : Checked<T[K]> } & { claim: boolean }
  : T extends readonly (infer U)[]
    ? Checked<U>[]
    : T extends object
      ? { [K in keyof T]: Checked<T[K]> }
      : T;

// One failed rule as `path:code`: schema keys and list positions, then zod's issue code. Prompt schemas declare their
// keys (no z.record, enforced by prompts.test.ts), so a path never holds output text; anything else is dropped rather
// than logged (AGENTS.md 1.2).
const RULE = /^(?:[a-z][A-Za-z]{0,40}|\d{1,3})(?:\.(?:[a-z][A-Za-z]{0,40}|\d{1,3})){0,8}:[a-z_]{1,40}$|^:[a-z_]{1,40}$/;

/**
 * Which schema rules an answer broke, as `suggestions.0.weight:too_big` or `:custom` (a whole-answer rule), at most 5.
 * A refinement may name its rule in the schema (`params: { reason: 'question_too_long' }`, AIV-P1-113): the name stands
 * for `custom`. It is the schema author's word, never the model's, and passes the same pattern check.
 */
export const schemaRules = (
  issues: readonly { path: readonly PropertyKey[]; code: string; params?: Record<string, unknown> | undefined }[],
): string[] =>
  [
    ...new Set(
      issues.map((issue) => {
        const reason = issue.code === 'custom' ? issue.params?.['reason'] : undefined;
        return `${issue.path.map(String).join('.')}:${typeof reason === 'string' ? reason : issue.code}`;
      }),
    ),
  ]
    .filter((rule) => RULE.test(rule))
    .slice(0, 5);

/** The output did not parse or did not match the task's schema. Neither the output nor the schema error is kept. */
export class SchemaMismatch extends Error {
  override name = 'SchemaMismatch';
  /** Which rules failed (`schemaRules`), or `json:invalid` for text that is not JSON; never the output (AIV-P1-082). */
  readonly rules: readonly string[];
  constructor(task: string, rules: readonly string[]) {
    super(`AI task ${task} returned output that does not match its schema`);
    this.rules = rules;
  }
}

/** A statement that must be cited came back with no citations. */
export class UncitedOutput extends Error {
  override name = 'UncitedOutput';
  constructor(task: string) {
    super(`AI task ${task} returned a statement with no citations`);
  }
}

/** A citation names a source the model was not given, or quotes text that is not in that source. */
export class InvalidCitation extends Error {
  override name = 'InvalidCitation';
  constructor(
    task: string,
    label: string,
    reason: 'unknown source' | 'quote not in source' | 'quotes removed text' | 'not a requested pair',
    /** The quote the model wrote, for the client's second attempt only: never in the message, a log or telemetry. */
    quote?: string,
  ) {
    // The label comes from the model: named only when it has the shape we gave, so no model text reaches the message.
    super(`AI task ${task} cited ${/^S\d{1,4}$/.test(label) ? label : 'a source'}: ${reason}`);
    // Not enumerable, so no serialiser (pino's `err`, a span's exception event) carries source text out.
    Object.defineProperty(this, 'quote', { value: quote, enumerable: false });
  }
  declare readonly quote?: string;
}

export const sourceLabel = (index: number) => `S${index + 1}`;

/**
 * The sources as the model sees them, numbered in order, each in a block marked untrusted (AIV-P1-070). A closing tag
 * or a fake opening tag inside the text is neutralised, so a CV cannot end its own block or forge another one. The model is told the block is
 * data (client.ts UNTRUSTED_CONTENT_RULES); labels resolve only to the real sources and code sets `claim`, so even an
 * obeyed instruction cannot forge backing.
 */
export const formatSources = (sources: readonly Source[]) =>
  sources
    .map((source, i) => {
      // Every ASCII `<`, not only `</source`: a zero-width character or a backslash inside a tag would slip past a
      // narrower match. checkOutput maps a quoted `&lt;` back to `<`. shortcut: look-alike brackets (`＜`) are left
      // as they are, since only `<` is structural; escape them too if an eval shows a model reading one as a tag.
      const text = source.text.replaceAll('<', '&lt;');
      return `<source id="${sourceLabel(i)}" kind="${source.kind}" trust="untrusted">\n${text}\n</source>`;
    })
    .join('\n');

/**
 * Where `quote` occurs in `text`, comparing with runs of whitespace collapsed to one space (case and punctuation must
 * match). Offsets index the original text.
 */
export function findQuote(text: string, quote: string): { start: number; end: number } | undefined {
  let flat = '';
  const at: number[] = []; // at[i]: the index in `text` of flat[i]
  for (let i = 0; i < text.length; i++) {
    const space = /\s/.test(text.charAt(i));
    if (space && (flat === '' || flat.endsWith(' '))) continue;
    flat += space ? ' ' : text.charAt(i);
    at.push(i);
  }
  const needle = quote.trim().replace(/\s+/g, ' ');
  const found = needle === '' ? -1 : flat.indexOf(needle);
  if (found < 0) return undefined;
  return { start: at[found] ?? 0, end: (at[found + needle.length - 1] ?? 0) + 1 };
}

/**
 * Parses the model's raw text against `schema` and the citation contract, or throws one of the three errors above.
 * With `onDropped`, a list element whose citation is invalid is left out (and `onDropped` called once per element)
 * instead of rejecting the whole answer: for extraction, where one bad statement must not lose the rest (AIV-P1-025).
 * With `redaction` (identifiers.ts, AIV-P1-080), quotes are checked against the text the model saw and their offsets and
 * quote returned in the original source.
 */
export function checkOutput<S extends z.ZodType>(
  task: string,
  text: string,
  schema: S,
  sources: readonly Source[],
  onDropped?: () => void,
  redaction?: Redaction,
): Checked<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SchemaMismatch(task, ['json:invalid']);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const uncited = parsed.error.issues.every(
      (issue) => issue.path.at(-1) === 'citations' && (issue.code === 'too_small' || issue.code === 'invalid_type'),
    );
    throw uncited ? new UncitedOutput(task) : new SchemaMismatch(task, schemaRules(parsed.error.issues));
  }

  const byLabel = new Map(sources.map((source, i) => [sourceLabel(i), i]));
  const dropped = Symbol('dropped');
  const keep = (element: unknown) => {
    try {
      return check(element);
    } catch (error) {
      if (!onDropped || !(error instanceof InvalidCitation)) throw error;
      onDropped();
      return dropped;
    }
  };
  const check = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(keep).filter((element) => element !== dropped);
    if (node === null || typeof node !== 'object') return node;
    const entries = Object.entries(node).filter(([key]) => key !== 'citations');
    const out = Object.fromEntries(entries.map(([key, value]) => [key, check(value)]));
    if (!('citations' in node)) return out;
    const kinds: SourceKind[] = [];
    const citations = (node.citations as z.infer<typeof citation>[]).map(({ sourceId: label, quote }): Citation => {
      const index = byLabel.get(label);
      const source = index === undefined ? undefined : sources[index];
      if (index === undefined || !source) throw new InvalidCitation(task, label, 'unknown source');
      // The model saw the redacted text, and `<` as `&lt;` (formatSources), so a quote may carry either back.
      const seen = redaction?.sources[index]?.text ?? source.text;
      const found = findQuote(seen, quote) ?? findQuote(seen, quote.replaceAll('&lt;', '<'));
      if (!found) throw new InvalidCitation(task, label, 'quote not in source', quote);
      const span = redaction ? redaction.original(index, found) : found;
      if (!span) throw new InvalidCitation(task, label, 'quotes removed text');
      kinds.push(source.kind);
      return { sourceId: source.id, quote: source.text.slice(span.start, span.end), ...span };
    });
    // Set here, after any `claim` the model gave, so only the sources decide it.
    const claim = kinds.some((kind) => CANDIDATE_WORDS.has(kind)) && kinds.every((kind) => BACKS_NOTHING.has(kind));
    return { ...out, citations, claim };
  };
  return check(parsed.data) as Checked<z.infer<S>>;
}
