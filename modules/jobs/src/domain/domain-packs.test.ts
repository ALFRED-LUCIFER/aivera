import { getTranslations } from '@aivera/i18n';
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_KEYS,
  DOMAIN_PACK_CATALOGUE_VERSION,
  JOB_TYPES,
  REGIONS,
  getDomainPack,
  listDomainPacks,
  type DomainPack,
  type RegionalHint,
} from '../contracts/index.ts';

// AIV-P1-061 Gherkin, read through the contracts entry as other modules do.
const t = await getTranslations('en', 'Asia/Dubai');
const names = (list: readonly { name: string }[]) => list.map((c) => c.name).join('; ');
const payments = listDomainPacks().find((p) => t(p.labelKey) === 'Payments and fintech');

// Proxies, never skills (AGENTS.md 1.5, 1.6): employers, "worked at", nationality, residency, permits, language as
// origin, age, gender, religion and marital status.
const PROXIES: RegExp[] = [
  /\b(worked|working|previously|formerly) (at|for)\b|\bemployed (at|by)\b|\bformer\b|\bex-[A-Za-z]/i,
  /\balumn(i|us|a)\b|\bgraduated? (of|from)\b|\brecent graduates?\b|\bfresh(ers?| graduates?)\b/i,
  /\btop[- ]tier\b|\btier[- ]?(1|one)\b|\bbig (four|4|tech)\b|\bfaang\b|\bblue[- ]chip\b|\bfortune 500\b|\breputed\b/i,
  /\b(inc|ltd|llc|pjsc|plc|gmbh)\b/i,
  /\bnationals\b|\b(a|an|gcc|uae|ksa|local) nationals?\b|\bnationality\b|\bcitizen(s|ship)?\b|\bpassport\b/i,
  /\b(saudi|emirati|indian|arab|expat|expatriate)s?\b|\b(emiratisation|emiratization|saudisation|saudization|nitaqat)\b/i,
  /\bresid(e|es|ing|ent|ents|ence|ency)\b|\blocals\b|\blocal (candidates?|hires?|talent)\b|\bin-country\b|\bcommut/i,
  /\blives? in\b|\bliving in\b|\bbased in\b|\bborn\b|\bcomes? from\b|\bfrom (the )?(uae|ksa|india|gcc)\b/i,
  /\bvisa\b|\biqama\b|\bemirates id\b|\bwork permit\b|\bsponsorship\b/i,
  /\bnative[- ](speak|arabic|english|hindi|urdu|language|tongue)|\bmother tongue\b|\b(arabic|english|hindi|urdu)[- ]?(speak(er|ers|ing)|native)\b|\bfluent\b/i,
  /\bage[ds]?\b|\byears old\b|\b(young|youthful|energetic)\b|\b(under|over|below|above) \d\d\b/i,
  /\b(gender|male|female|man|woman|men|women|he|she|his|her|hers|him|ladies|gentlem[ae]n|girls?|boys?)\b/i,
  /\b(married|marital|religion|religious|muslim|christian|hindu)\b/i,
];
// Every capitalised word after a string's first is a known standard, acronym or regional name, so an employer or
// brand fails until a reviewer adds it here on purpose.
// shortcut: a lowercase or sentence-initial company name escapes this; widen with a reviewed dictionary if a pack PR
// slips one past review.
const PROPER_NOUNS = new Set(
  'AA AAOIFI ABDM ABHA ADT AMF AML API APIs Aadhaar Aani Abu Arabic BSS CBUAE CEA CFT CPT CST D DHA DLT DNP3 DSS Dhabi DigiLocker DoE DoH DoT ECC EMR EMRs ETAs FASAH FHIR Fatoora Forum GST HL7 HSE ICD-10 ID IDs IEC IFRS ISO IT Islamic KYC Malaffi Modbus NABIDH NCA NETCONF NPCI NPHIES Nafath OIDC ONDC OPC ORU OSS OT OTCC Open PASS PCI QR R4 RBI REST SADAD SAMA SAML SCA SCADA SERA SIM SMART SMF Secure Sharia TDRA TLS TM TRAI UA UAE UIDAI UPF UPI VAT VEE WCAG XML YANG ZATCA'.split(
    ' ',
  ),
);
// Regional regulators, schemes and exchanges: knowledge shown with evidence, so only inside regional hints.
const REGIONAL_NAMES =
  /\b(CBUAE|Aani|SAMA|mada|SADAD|NPCI|UPI|RBI|RuPay|DHA|DoH|NABIDH|Malaffi|NPHIES|ABDM|ABHA|UAE PASS|Nafath|Aadhaar|UIDAI|DigiLocker|ZATCA|Fatoora|GST|ONDC|FASAH|TDRA|CST|TRAI|DoT|DoE|Abu Dhabi|SERA|CEA|NCA)\b/;

const stringsOf = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(stringsOf)
      : [];
const catalogueStrings = (packs: readonly DomainPack[]) => [...stringsOf(packs), ...packs.map((p) => t(p.labelKey))];
const unknownProperNouns = (s: string) => [...s.matchAll(/(?<=.)\b[A-Z][\w-]*/g)].some(([w]) => !PROPER_NOUNS.has(w));
const fairnessViolations = (strings: string[]) =>
  strings.filter((s) => PROXIES.some((re) => re.test(s)) || unknownProperNouns(s));

describe('domain packs', () => {
  it('gives software engineering in payments niche core competencies, and the rest as more from this pack', () => {
    const pack = payments && getDomainPack(payments.key, 'software_engineering');
    expect(names(pack?.core ?? [])).toBe(
      'Idempotent payment APIs and retries; Ledger and double-entry accounting; Reconciliation and settlement; PCI DSS scope reduction and tokenisation',
    );
    expect(names(pack?.more ?? [])).toBe(
      '3-D Secure and SCA flows; Fraud and risk signals; Payment gateway and acquirer integration with webhooks; ISO 8583 and ISO 20022 messaging',
    );
  });

  it.each([
    [
      'product_management',
      'Authorisation and conversion rates; Scheme and regulatory rules; Payment methods by market; Disputes and chargebacks',
    ],
    ['data_ml', 'Fraud and risk signals'],
    ['qa_test_automation', 'Payment certification and test cards'],
  ] as const)('gives %s in payments its own core competencies', (jobType, core) => {
    expect(names(getDomainPack('payments_fintech', jobType)?.core ?? [])).toBe(core);
  });

  it('states the evidence and level guide of a competency', () => {
    const c = payments?.competencies.find((x) => x.name === 'Idempotent payment APIs and retries');
    expect(c?.evidence).toBe(
      'Code with idempotency keys and retry tests; incident reviews of duplicate charges; design documents',
    );
    expect(c?.levels).toEqual({
      1: 'Has called a payment API and handled declines',
      3: 'Built an endpoint where a retried charge is applied once, with tests that prove it',
      5: 'Designed retry, timeout and idempotency rules across services, with evidence a duplicate charge cannot happen under failure',
    });
  });

  it.each([
    ['uae', 'CBUAE payment and stored-value rules; Aani instant payments; Local acquirer integration'],
    ['ksa', 'mada scheme integration; SADAD bill payments; SAMA payment rules'],
    ['india', 'UPI and NPCI rules; RBI payment aggregator guidelines; Card-on-file tokenisation'],
  ] as const)('gives payments %s hints as desirable knowledge with evidence', (region, hints) => {
    const list = payments?.hints[region] ?? [];
    expect(names(list)).toBe(hints);
    for (const hint of list) {
      expect(hint.type).toBe('desirable');
      expect(hint.evidence).toMatch(/integration code|compliance write-ups|certification/i);
    }
  });

  it('keeps every catalogue string a skill, never a proxy', () => {
    // SAFETY: mutation check: renamed a payments competency to "Worked at a top-tier bank", then "UAE nationals",
    // then "Payments at Emirates NBD" -> 'keeps every catalogue string a skill, never a proxy' failed each time.
    // SAFETY: mutation check (AIV-P1-062): renamed a banking competency to "Basel and IFRS 9 risk reporting for Saudi
    // banks" -> this test failed.
    expect(fairnessViolations(catalogueStrings(listDomainPacks()))).toEqual([]);
  });

  it('fails the fairness check when a pack names an employer, a nationality, residency or an age', () => {
    const [first, ...rest] = listDomainPacks();
    const template = first?.competencies[0];
    if (!first || !template) throw new Error('catalogue is empty');
    for (const proxy of [
      'Worked at a top-tier bank',
      'UAE nationals',
      'Saudi national',
      'Native Arabic speaker',
      'native-speaker level',
      'Fluent Arabic speaker',
      'Residing in Dubai',
      'Living in Riyadh',
      'Holds a valid Iqama',
      'Previously at Emirates NBD',
      'Payments experience at Careem Pay',
      'Graduated from a top university',
      'Under 35',
      'Below 30',
      'Ladies only',
      'Married',
    ])
      expect(
        fairnessViolations(
          catalogueStrings([
            { ...first, competencies: [...first.competencies, { ...template, name: proxy }] },
            ...rest,
          ]),
        ),
      ).toEqual([proxy]);
  });

  it('names regulators and schemes only as regional knowledge, never as a residency requirement', () => {
    // SAFETY: mutation check (AIV-P1-062): put "Nafath" in a banking competency's level guide -> this test failed.
    for (const pack of listDomainPacks()) {
      expect(stringsOf(pack.competencies).filter((s) => REGIONAL_NAMES.test(s))).toEqual([]);
      for (const hint of REGIONS.flatMap((r) => pack.hints[r])) {
        expect(hint.type).toBe('desirable');
        expect(hint.evidence).not.toBe('');
        expect(fairnessViolations(stringsOf(hint)), hint.name).toEqual([]);
      }
    }
    // @ts-expect-error the catalogue cannot make a regional hint mandatory
    const mandatory: RegionalHint['type'] = 'mandatory';
    expect(mandatory).toBe('mandatory');
  });

  it('keeps the shape rules', () => {
    const packs = listDomainPacks();
    expect(packs.map((p) => p.key)).toEqual(DOMAIN_KEYS);
    expect(new Set(DOMAIN_KEYS).size).toBe(DOMAIN_KEYS.length);
    for (const pack of packs) {
      expect(t(pack.labelKey), pack.labelKey).not.toBe(pack.labelKey);
      expect(Object.keys(pack.hints)).toEqual([...REGIONS]);
      const all = [...pack.competencies, ...REGIONS.flatMap((r) => pack.hints[r])];
      expect(new Set(all.map((c) => c.name)).size, pack.key).toBe(all.length);
      for (const c of all) {
        expect(c.meaning, c.name).toMatch(/^[^.]+\.$/);
        expect([c.levels[1], c.levels[3], c.levels[5]].every(Boolean), c.name).toBe(true);
        expect(Object.keys(c.levels), c.name).toEqual(['1', '3', '5']);
        expect([2, 3], c.name).toContain(c.levelNeeded);
        expect(c.type, c.name).toBe('desirable');
        expect(c.appliesTo.length, c.name).toBeGreaterThan(0);
        expect(
          c.appliesTo.every((j) => JOB_TYPES.includes(j)),
          c.name,
        ).toBe(true);
      }
      for (const c of pack.competencies)
        expect(
          c.core.every((j) => c.appliesTo.includes(j)),
          c.name,
        ).toBe(true);
      for (const jobType of JOB_TYPES)
        expect(
          pack.competencies.filter((c) => c.core.includes(jobType)).length,
          `${pack.key} ${jobType}`,
        ).toBeLessThanOrEqual(4);
    }
  });

  // AIV-P1-062 Gherkin: six more packs.
  it.each([
    ['Banking and Islamic finance', 'Core banking integration'],
    ['E-commerce and marketplaces', 'Catalogue and search relevance'],
    ['Logistics and mobility', 'Route and dispatch optimisation'],
    ['Government and public sector', 'National digital identity sign-in'],
    ['Telecom', 'OSS/BSS systems'],
    ['Energy and utilities', 'OT and SCADA security (IEC 62443)'],
  ])('gives software engineering in %s the core competency "%s" first, and hints for every region', (label, first) => {
    const key = listDomainPacks().find((p) => t(p.labelKey) === label)?.key;
    const pack = key && getDomainPack(key, 'software_engineering');
    expect(pack?.core[0]?.name).toBe(first);
    for (const region of REGIONS) expect(pack?.hints[region].length, region).toBeGreaterThan(0);
  });

  it('lists eight packs in a fixed order', () => {
    const labels = listDomainPacks().map((p) => t(p.labelKey));
    expect(labels).toHaveLength(8);
    expect([labels[0], labels.at(-1)]).toEqual(['Payments and fintech', 'Energy and utilities']);
  });

  it.each([
    ['healthcare', 'sales'],
    ['telecom', 'product_design'],
  ] as const)('gives %s for %s empty lists, so the job type starters stay the only defaults', (key, jobType) => {
    expect(getDomainPack(key, jobType)).toMatchObject({
      core: [],
      more: [],
      hints: { uae: [], ksa: [], india: [] },
    });
  });

  it('is read-only and shows every change in review', () => {
    const packs = listDomainPacks();
    expect(Object.isFrozen(packs)).toBe(true);
    expect(packs.every((p) => Object.isFrozen(p) && Object.isFrozen(p.competencies[0]?.levels))).toBe(true);
    expect({ version: DOMAIN_PACK_CATALOGUE_VERSION, packs }).toMatchSnapshot();
  });
});
