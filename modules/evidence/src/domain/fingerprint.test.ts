import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  crossApplicantMatches,
  FINGERPRINT_MIN_TEXT,
  fingerprintText as fingerprintWith,
  groupOrigins,
  NEAR_DUPLICATE_THRESHOLD,
  normalizeText,
  similarity,
} from './fingerprint.ts';

// AIV-P1-071. Synthetic text only (AGENTS.md 1.1).
const fingerprintText = (text: string) => fingerprintWith(text, (input) => createHash('sha1').update(input).digest());
const PAYMENTS =
  'Senior backend engineer working on distributed payment platforms. You will design and operate high throughput services, own reliability, and mentor other engineers across the payments organisation. Experience with Go, Kubernetes and event driven systems is expected for this role.';
const TOPICS = [
  'recall',
  'precision',
  'latency',
  'cost',
  'drift',
  'coverage',
  'labels',
  'queries',
  'passages',
  'reranking',
];
/** A synthetic write-up of about 900 words, as in the ticket's scenario. */
const writeUp = (title = 'Retrieval evaluation harness') =>
  `${title}\n${Array.from(
    { length: 64 },
    (_, i) =>
      `In week ${i + 1} the harness measured ${TOPICS[i % 10]} against ${TOPICS[(i * 3 + 1) % 10]} over ${((i * 7) % 50) + 3} merchant questions.`,
  ).join(' ')}`;

describe('normalizeText', () => {
  it('drops tags, entities and URLs, lowercases, and keeps Arabic words whole with their marks', () => {
    expect(normalizeText('<p>Built &amp; shipped</p> https://repo.aivera.example/x the HARNESS')).toBe(
      'built shipped the harness',
    );
    expect(normalizeText('بَنَيْتُ نظام التقييم، للمساعد')).toBe('بَنَيْتُ نظام التقييم للمساعد');
  });
});

describe('fingerprintText', () => {
  // The upstream implementation's output for these texts, computed with it unchanged: the port matches bit for bit.
  it.each([
    [PAYMENTS, '16e62027e5fd1c58'],
    [
      '<p>Senior backend engineer working on <b>distributed</b> payment platforms &amp; services.</p> See https://jobs.example/123 for details. You will design and operate high throughput services, own reliability, and mentor other engineers across the payments organisation.',
      '16340025854d1648',
    ],
    [
      'We built a retrieval evaluation harness for the merchant help assistant. Each week the harness replays four hundred real support questions against the index, scores the top five passages for relevance, and reports recall at five next to the previous release so regressions are caught before they ship to merchants.',
      'fa5da4520d70096c',
    ],
  ])('matches the upstream fixed vector %#', (text, expected) => {
    expect(fingerprintText(text)).toBe(expected);
  });

  it('identical text scores 1, a changed title and two edited sentences at least 0.92, unrelated text below', () => {
    const original = fingerprintText(writeUp());
    const edited = fingerprintText(
      writeUp('How we evaluate retrieval')
        .replace('In week 3 the harness measured', 'During the third week we checked')
        .replace('over 38 merchant questions', 'across 38 support questions'),
    );
    expect(similarity(original, original)).toBe(1);
    expect(similarity(original, edited)).toBeGreaterThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
    expect(similarity(original, fingerprintText(PAYMENTS))).toBeLessThan(NEAR_DUPLICATE_THRESHOLD);
  });

  it.each(['Python, SQL, Docker', 'Sara Al Qahtani · sara@example.com · Dubai', 'Experience Education Skills', ''])(
    'gives "%s" no fingerprint',
    (text) => {
      expect(fingerprintText(text)).toBeNull();
    },
  );

  // SAFETY: mutation check: FINGERPRINT_MIN_TEXT set to 0 -> this test failed (a short text got a fingerprint)
  it(`needs ${FINGERPRINT_MIN_TEXT} normalised characters on lines of more than three words`, () => {
    expect(FINGERPRINT_MIN_TEXT).toBe(200);
    expect(fingerprintText('a'.repeat(400))).toBeNull();
    expect(fingerprintText(`${'a'.repeat(200)} b c`)).toBeNull();
    expect(fingerprintText(`${'a'.repeat(150)} b c d`)).toBeNull();
    expect(fingerprintText(`${'a'.repeat(200)} b c d`)).toMatch(/^[0-9a-f]{16}$/);
  });

  // SAFETY: mutation check: stripBoilerplate returned its input unchanged -> this test and the length test failed
  it('skips CV boilerplate: a contact block, headings and a skills list change nothing, and alone get no fingerprint', () => {
    const boilerplate =
      'Sara Al Qahtani\nsara@example.com · +971 50 000 0001\nExperience\nSkills\nPython, SQL, Docker, Kubernetes';
    expect(fingerprintText(`${boilerplate}\n${PAYMENTS}`)).toBe(fingerprintText(PAYMENTS));
    expect(fingerprintText(boilerplate.repeat(10))).toBeNull();
  });
});

describe('similarity', () => {
  const zeros = '0000000000000000';
  it('counts differing bits in either half, including the top bit', () => {
    expect(similarity('8000000000000000', zeros)).toBe(1 - 1 / 64);
    expect(similarity('0000000080000000', zeros)).toBe(1 - 1 / 64);
    expect(similarity('ffffffffffffffff', zeros)).toBe(0);
  });

  it('0.92 admits 5 differing bits and refuses 6', () => {
    expect(similarity('000000000000001f', zeros)).toBeGreaterThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
    expect(similarity('000000000000003f', zeros)).toBeLessThan(NEAR_DUPLICATE_THRESHOLD);
  });

  it.each([
    [zeros, ''],
    ['', ''],
    [zeros, 'zzzz'],
    [zeros, 'FFFFFFFFFFFFFFFF'],
    [zeros, '00000000000000000'],
    [null, zeros],
    [null, null],
  ])('an empty or malformed fingerprint never matches (%s, %s)', (a, b) => {
    expect(similarity(a, b)).toBe(0);
  });
});

describe('origins and cross-applicant matches', () => {
  const fp = fingerprintText(writeUp());
  const copy = fingerprintText(writeUp('Merchant help assistant write-up'));
  const other = fingerprintText(PAYMENTS);

  // SAFETY: mutation check: dropped the candidateId comparison in groupOrigins -> this test failed (grouped across candidates)
  it("collapses one candidate's near-duplicates into one origin, never across candidates", () => {
    expect(
      groupOrigins([
        { id: 's1', candidateId: 'sara', textFingerprint: fp },
        { id: 's2', candidateId: 'sara', textFingerprint: other },
        { id: 's3', candidateId: 'maria', textFingerprint: fp },
        { id: 's4', candidateId: 'sara', textFingerprint: copy },
        { id: 's5', candidateId: 'sara', textFingerprint: null },
        { id: 's6', candidateId: 'sara', textFingerprint: null },
      ]),
    ).toEqual([['s2'], ['s3'], ['s1', 's4'], ['s5'], ['s6']]);
  });

  it("matches only another candidate's near-duplicate", () => {
    expect(
      crossApplicantMatches({ id: 'new', candidateId: 'omar', textFingerprint: copy }, [
        { id: 'a', candidateId: 'maria', textFingerprint: fp },
        { id: 'b', candidateId: 'omar', textFingerprint: fp },
        { id: 'c', candidateId: 'maria', textFingerprint: other },
        { id: 'd', candidateId: 'maria', textFingerprint: null },
      ]).map((m) => m.id),
    ).toEqual(['a']);
  });
});
