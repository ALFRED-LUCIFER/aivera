import { z } from 'zod';

// The citation contract (AIV-P0-028, ADR-006 points 3 to 5, AGENTS.md 1.6): the model sees numbered sources, every
// cited statement names the sources it rests on with a verbatim quote, and code, not the model, checks each quote and
// decides what is only a claim. Errors carry the task and a source label at most: never a quote, source text or the
// model's raw output (AGENTS.md 1.2).

export type SourceKind = 'cv' | 'repo' | 'document' | 'reference' | 'interview' | 'job_description';

/** One piece of text the model may cite. `id` is the caller's opaque id (an evidence id); it never reaches the model. */
export type Source = { id: string; kind: SourceKind; text: string; uri?: string };

// The candidate's own account of themselves: a statement resting only on these is a claim, counting zero when backed.
const CANDIDATE_WORDS: ReadonlySet<SourceKind> = new Set(['cv']);

/** What the model returns for each citation: the source label it was shown (`S1`) and a quote from that source. */
const citation = z.object({ sourceId: z.string(), quote: z.string().min(1) });

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

/** The output did not parse or did not match the task's schema. Neither the output nor the schema error is kept. */
export class SchemaMismatch extends Error {
  override name = 'SchemaMismatch';
  constructor(task: string) {
    super(`AI task ${task} returned output that does not match its schema`);
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
  constructor(task: string, label: string, reason: 'unknown source' | 'quote not in source') {
    // The label comes from the model: named only when it has the shape we gave, so no model text reaches the message.
    super(`AI task ${task} cited ${/^S\d{1,4}$/.test(label) ? label : 'a source'}: ${reason}`);
  }
}

export const sourceLabel = (index: number) => `S${index + 1}`;

/** The sources as the model sees them, numbered in order. */
export const formatSources = (sources: readonly Source[]) =>
  sources
    .map((source, i) => `<source id="${sourceLabel(i)}" kind="${source.kind}">\n${source.text}\n</source>`)
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

/** Parses the model's raw text against `schema` and the citation contract, or throws one of the three errors above. */
export function checkOutput<S extends z.ZodType>(
  task: string,
  text: string,
  schema: S,
  sources: readonly Source[],
): Checked<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SchemaMismatch(task);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const uncited = parsed.error.issues.every(
      (issue) => issue.path.at(-1) === 'citations' && (issue.code === 'too_small' || issue.code === 'invalid_type'),
    );
    throw uncited ? new UncitedOutput(task) : new SchemaMismatch(task);
  }

  const byLabel = new Map(sources.map((source, i) => [sourceLabel(i), source]));
  const check = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(check);
    if (node === null || typeof node !== 'object') return node;
    const entries = Object.entries(node).filter(([key]) => key !== 'citations');
    const out = Object.fromEntries(entries.map(([key, value]) => [key, check(value)]));
    if (!('citations' in node)) return out;
    const kinds: SourceKind[] = [];
    const citations = (node.citations as z.infer<typeof citation>[]).map(({ sourceId: label, quote }): Citation => {
      const source = byLabel.get(label);
      if (!source) throw new InvalidCitation(task, label, 'unknown source');
      const span = findQuote(source.text, quote);
      if (!span) throw new InvalidCitation(task, label, 'quote not in source');
      kinds.push(source.kind);
      return { sourceId: source.id, quote: source.text.slice(span.start, span.end), ...span };
    });
    // Set here, after any `claim` the model gave, so only the sources decide it.
    return { ...out, citations, claim: kinds.every((kind) => CANDIDATE_WORDS.has(kind)) };
  };
  return check(parsed.data) as Checked<z.infer<S>>;
}
