import { describe, expect, it } from 'vitest';
import {
  blankCompetency,
  changeRow,
  excerptOf,
  morePackCompetencies,
  packCompetencies,
  parseRubric,
  rowErrors,
  rubricJson,
  starterCompetencies,
  toDetectedIndustry,
  toDraftCompetency,
  visibleRows,
  withPack,
  type DraftRow,
} from './draft.ts';

const description =
  'You will ship and run LLM assistants that real merchants use. You keep latency, cost per request and incidents in check.';

describe('excerptOf', () => {
  it('is the sentence holding the quote, with the quote offsets inside it', () => {
    const quote = 'latency, cost per request';
    const start = description.indexOf(quote);
    const excerpt = excerptOf(description, start, start + quote.length);
    expect(excerpt.text).toBe('You keep latency, cost per request and incidents in check.');
    expect(excerpt.text.slice(excerpt.start, excerpt.end)).toBe(quote);
  });

  it('is the list line in a bulleted description', () => {
    const list = 'Needs:\n- Python services in production\n- Eval sets';
    const start = list.indexOf('Python');
    const excerpt = excerptOf(list, start, start + 6);
    expect(excerpt.text).toBe('- Python services in production');
    expect(excerpt.text.slice(excerpt.start, excerpt.end)).toBe('Python');
  });

  it('spans every sentence a quote crosses', () => {
    const start = description.indexOf('merchants');
    const end = description.indexOf('latency') + 'latency'.length;
    expect(excerptOf(description, start, end).text).toBe(description);
  });
});

describe('toDraftCompetency', () => {
  it('keeps the rubric fields and turns each citation into an excerpt', () => {
    const start = description.indexOf('ship and run');
    const drafted = toDraftCompetency(description, {
      name: 'LLM systems in production',
      evidenceExpected: 'A shipped assistant',
      weightPercent: 25,
      levelNeeded: 4,
      type: 'mandatory',
      origin: 'from_description',
      citations: [{ sourceId: 'description', quote: 'ship and run', start, end: start + 12 }],
    });
    expect(drafted).toEqual({
      name: 'LLM systems in production',
      evidenceExpected: 'A shipped assistant',
      weightPercent: 25,
      levelNeeded: 4,
      type: 'mandatory',
      origin: 'from_description',
      why: null,
      excerpts: [{ text: 'You will ship and run LLM assistants that real merchants use.', start: 9, end: 21 }],
      pack: null,
    });
  });

  it('keeps a suggestion its origin and its why (AIV-P1-009)', () => {
    const start = description.indexOf('real merchants');
    const suggested = toDraftCompetency(description, {
      name: 'Product judgement',
      evidenceExpected: 'Product decisions',
      weightPercent: 15,
      levelNeeded: 3,
      type: 'desirable',
      origin: 'suggested_by_aivera',
      why: 'Merchants use it, but the description asks for no product judgement.',
      citations: [{ sourceId: 'description', quote: 'real merchants', start, end: start + 14 }],
    });
    expect(suggested).toMatchObject({
      origin: 'suggested_by_aivera',
      why: 'Merchants use it, but the description asks for no product judgement.',
    });
  });
});
const row = (id: string, change: Partial<DraftRow> = {}): DraftRow => ({
  ...blankCompetency(),
  name: 'Cost and reliability',
  id,
  removed: false,
  ...change,
});

describe('Saving the rubric (AIV-P1-010)', () => {
  // SAFETY: mutation check: rowErrors skipped the name check -> this test failed (a nameless row could be saved)
  it('names each kept row to fix: no name, or a weight that is not a whole percent from 1 to 100', () => {
    const rows = [
      row('a'),
      row('b', { name: '  ' }),
      row('c', { weightPercent: 0 }),
      row('d', { weightPercent: 12.5, name: '' }),
      row('e', { name: '', removed: true }),
    ];
    expect(rowErrors(rows)).toEqual({ b: { name: true }, c: { weight: true }, d: { name: true, weight: true } });
  });

  it('posts the kept rows only, with their origin, and the server reads back the same competencies', () => {
    const rows = [row('a', { origin: 'suggested_by_aivera', why: 'Why.' }), row('b', { removed: true })];
    expect(parseRubric(rubricJson(rows))).toEqual([
      {
        name: 'Cost and reliability',
        evidenceExpected: '',
        weightPercent: 10,
        levelNeeded: 3,
        type: 'mandatory',
        origin: 'suggested_by_aivera',
        packKey: null,
        packVersion: null,
      },
    ]);
    expect(parseRubric(rubricJson([row('b', { removed: true })]))).toBeNull();
  });
});

describe('starterCompetencies', () => {
  it("is the job type's four starters, weights totalling 100, and nothing before a job type is chosen", () => {
    const starters = starterCompetencies('ai_llm_engineering');
    expect(starters.map((c) => c.name)).toEqual([
      'LLM systems in production',
      'Retrieval and evaluation',
      'Python service engineering',
      'Cost and reliability',
    ]);
    expect(starters.reduce((sum, c) => sum + c.weightPercent, 0)).toBe(100);
    expect(starterCompetencies('')).toEqual([]);
  });
});

// Feature: Suggest an industry's competencies in Add a job (AIV-P1-064). Synthetic job text only.
const PAYMENTS = 'You will build the card acquiring platform that settles merchant payments across the Gulf.';
const names = (list: readonly { name: string }[]) => list.map((c) => c.name);
const ids = (list: ReturnType<typeof packCompetencies>): DraftRow[] =>
  list.map((c, i) => ({ ...c, id: `p${i}`, removed: false }));
const byName = (list: readonly DraftRow[], name: string) => {
  const found = list.find((c) => c.name === name);
  if (!found) throw new Error(`no row ${name}`);
  return found;
};

describe("Scenario: The pack's core competencies are suggested", () => {
  const pack = packCompetencies('payments_fintech', 'software_engineering', ['uae']);

  it('suggests the four core competencies, then the UAE hints, each desirable, from the pack at its version', () => {
    expect(names(pack.filter((c) => !c.pack?.region))).toEqual([
      'Idempotent payment APIs and retries',
      'Ledger and double-entry accounting',
      'Reconciliation and settlement',
      'PCI DSS scope reduction and tokenisation',
    ]);
    expect(names(pack.filter((c) => c.pack?.region === 'uae'))).toEqual(
      expect.arrayContaining(['CBUAE payment and stored-value rules', 'Aani instant payments']),
    );
    for (const c of pack) {
      expect(c).toMatchObject({
        type: 'desirable',
        origin: 'domain_pack',
        pack: { key: 'payments_fintech', version: 1 },
      });
    }
  });

  it('offers the rest of the pack under "More from this pack", minus any already in the rows', () => {
    const more = names(
      morePackCompetencies('payments_fintech', 'software_engineering', [{ name: '3-d secure and SCA flows' }]),
    );
    expect(more).not.toContain('3-D Secure and SCA flows');
    expect(more).toContain('Fraud and risk signals');
    expect(more).not.toContain('Ledger and double-entry accounting');
  });

  it('shows the detected industry with its cited sentence, and no industry when detection is none or failed', () => {
    const text = `We are a Gulf payments company. ${PAYMENTS}`;
    const start = text.indexOf('card acquiring');
    const detection = {
      domain: 'payments_fintech' as const,
      citations: [{ sourceId: 'description', quote: 'card acquiring', start, end: start + 14 }],
      regions: [{ region: 'uae' as const, citations: [] }],
    };
    expect(toDetectedIndustry(text, detection)).toEqual({
      industry: { key: 'payments_fintech', excerpts: [{ text: PAYMENTS, start: 19, end: 33 }] },
      regions: ['uae'],
    });
    expect(toDetectedIndustry(text, { domain: 'none', citations: [], regions: [] })).toEqual({
      industry: null,
      regions: [],
    });
    expect(toDetectedIndustry(text, null)).toEqual({ industry: null, regions: [] });
  });

  it('every pack competency and hint passes the rubric the server reads', () => {
    for (const key of ['payments_fintech', 'healthcare', 'telecom'] as const) {
      const rows = ids(packCompetencies(key, 'software_engineering', ['uae', 'ksa', 'india']));
      expect(parseRubric(rubricJson(rows))).toHaveLength(rows.length);
    }
  });
});

describe('Scenario: I decide what stays', () => {
  it('posts a kept pack competency with origin domain_pack, its pack and the catalogue version; a removed one not', () => {
    const pack = ids(packCompetencies('payments_fintech', 'software_engineering', []));
    const rows = [
      byName(pack, 'Idempotent payment APIs and retries'),
      { ...byName(pack, 'Reconciliation and settlement'), removed: true },
    ];
    expect(parseRubric(rubricJson(rows))).toEqual([
      expect.objectContaining({
        name: 'Idempotent payment APIs and retries',
        origin: 'domain_pack',
        packKey: 'payments_fintech',
        packVersion: 1,
      }),
    ]);
  });

  it('the server refuses a pack version the catalogue does not have, or an unknown pack', () => {
    const competency = { name: 'Ledger', evidenceExpected: '', weightPercent: 10, levelNeeded: 3, type: 'desirable' };
    const post = (extra: object) => parseRubric(JSON.stringify([{ ...competency, origin: 'domain_pack', ...extra }]));
    expect(post({ packKey: 'payments_fintech', packVersion: 2 })).toBeNull();
    expect(post({ packKey: 'crypto', packVersion: 1 })).toBeNull();
  });
});

describe('Scenario: Wrong industry', () => {
  const drafted = row('d', { name: 'Card acquiring platform', origin: 'from_description' });
  const payments = ids(packCompetencies('payments_fintech', 'software_engineering', ['uae']));

  it('a new pack replaces every row of the old one, kept or removed; no industry leaves the rest', () => {
    const rows = [drafted, ...payments.map((r, i) => (i === 0 ? { ...r, removed: true } : r))];
    const ecommerce = ids(packCompetencies('ecommerce_marketplaces', 'software_engineering', ['uae']));
    const swapped = withPack(rows, ecommerce);
    expect(swapped[0]).toBe(drafted);
    expect(swapped.slice(1)).toEqual(ecommerce);
    expect(withPack(rows, [])).toEqual([drafted]);
  });
});

describe('Scenario: No duplicates with the description or AIV-P1-009', () => {
  it('a pack competency the description already asks for appears once, as drafted', () => {
    const drafted = row('d', { name: 'PCI DSS scope reduction and tokenisation ', origin: 'from_description' });
    const rows = withPack([drafted], ids(packCompetencies('payments_fintech', 'software_engineering', [])));
    expect(rows.filter((r) => /PCI DSS/.test(r.name))).toEqual([drafted]);
    expect(rows).toHaveLength(4);
  });

  it('hides the generic industry suggestion while a pack applies, and brings it back without one', () => {
    const generic = row('g', { name: 'Banking and payments domain', origin: 'suggested_by_aivera' });
    const other = row('o', { name: 'Product judgement', origin: 'suggested_by_aivera' });
    const ddd = row('x', { name: 'Domain-driven design', origin: 'suggested_by_aivera' });
    const model = row('m', { name: 'Domain modelling', origin: 'suggested_by_aivera' });
    expect(visibleRows([generic, other, ddd, model], 'payments_fintech')).toEqual([other, ddd, model]);
    expect(
      visibleRows([row('k', { name: 'Retail industry knowledge', origin: 'suggested_by_aivera' })], 'payments_fintech'),
    ).toEqual([]);
    expect(visibleRows([generic, other], null)).toEqual([generic, other]);
  });
});

describe('Scenario: Regional knowledge never becomes mandatory or a location filter', () => {
  const pack = ids(packCompetencies('payments_fintech', 'software_engineering', ['uae']));
  const hint = byName(pack, 'Aani instant payments');

  // SAFETY: mutation check: changeRow allowed type mandatory on a regional hint -> this test failed
  it('refuses Mandatory on a regional hint, even renamed, and on a row named like one', () => {
    expect(hint.pack?.region).toBe('uae');
    expect(changeRow(hint, { type: 'mandatory' })).toBeNull();
    expect(changeRow({ ...hint, name: 'Gulf payment rules' }, { type: 'mandatory' })).toBeNull();
    expect(changeRow(row('r', { type: 'desirable', name: 'Aani instant payments' }), { type: 'mandatory' })).toBeNull();
  });

  it('allows any other change, and Mandatory on a core pack competency', () => {
    expect(changeRow(hint, { levelNeeded: 3 })).toMatchObject({ levelNeeded: 3, type: 'desirable' });
    const core = byName(pack, 'Reconciliation and settlement');
    expect(changeRow(core, { type: 'mandatory' })).toMatchObject({ type: 'mandatory' });
  });
});
