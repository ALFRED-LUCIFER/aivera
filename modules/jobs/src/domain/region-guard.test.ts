import { describe, expect, it } from 'vitest';
import { aboutPeopleToHire, regionsNotAboutPeople } from './region-guard.ts';

// AIV-P2-082: a region never rests on a line about the people to hire. Synthetic job text only.

const region = (key: string, ...quotes: string[]) => ({ region: key, citations: quotes.map((quote) => ({ quote })) });

describe('Scenario: A region citing only a line about the people to hire is dropped', () => {
  // SAFETY: mutation check: `.some(...)` filter replaced by `true` in regionsNotAboutPeople -> this test failed (uae kept)
  it('drops uae when its only citation is the nationality line', () => {
    expect(regionsNotAboutPeople([region('uae', 'UAE nationals preferred.')])).toEqual([]);
  });

  it.each([
    'UAE nationals preferred.',
    'Saudi nationality required',
    'Open to GCC citizens only.',
    'Applicants must hold UAE residency.',
    'Must be a resident of Riyadh',
    'An Indian passport holder',
    'Ideally born in the UAE.',
    'Native speakers of Arabic preferred.',
    'Candidates from Kerala are welcome.',
    'Aged 25 to 35.',
    'Male applicants only.',
    'Gender: any.',
  ])('reads "%s" as a line about the people to hire', (quote) => {
    expect(aboutPeopleToHire(quote)).toBe(true);
  });
});

describe('Scenario: A real location keeps its region', () => {
  it.each(['Based in Dubai', 'DIFC, Dubai', 'We have offices in Riyadh.', 'Our team works from Abu Dhabi.'])(
    'keeps the region cited by "%s"',
    (quote) => {
      expect(aboutPeopleToHire(quote)).toBe(false);
      expect(regionsNotAboutPeople([region('uae', quote)])).toHaveLength(1);
    },
  );

  it('keeps a region when one citation is a location, beside a nationality line', () => {
    const mixed = region('uae', 'UAE nationals preferred.', 'Based in Dubai');
    expect(regionsNotAboutPeople([mixed])).toEqual([mixed]);
  });

  it('keeps a quote that names the office in one sentence and the nationality in the next', () => {
    expect(aboutPeopleToHire('Based in Dubai. UAE nationals preferred.')).toBe(false);
  });

  it('drops only the region that rests on the people line', () => {
    const ksa = region('ksa', 'We have offices in Riyadh.');
    expect(regionsNotAboutPeople([region('uae', 'UAE nationals preferred.'), ksa])).toEqual([ksa]);
  });
});
