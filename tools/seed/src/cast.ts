// The synthetic demo cast (docs/00-product/personas.md, AIV-P0-031). Every person here is invented: emails are on the
// reserved example.com domain and phones are in Ofcom's drama range +44 7700 900000–900999, which never rings anyone.
// Module tickets seed from this file: candidates, industry jobs and the design jobs now; applications, evidence,
// interviews and packs when they land.
import type { Provenance, SourceKind, Strength } from '@credalent/evidence';
import { nameKey, packForJobType, type CatalogueVersion, type Competency } from '@credalent/jobs';

type Synthetic = { synthetic: true };
export type CastUser = Synthetic & { key: string; displayName: string; email: string };
export type CastCandidate = Synthetic & { displayName: string; email: string; phone: string; location: string };
export type CastJob = {
  title: string;
  jobType: string;
  team: string;
  location: string;
  /** `key` of the hiring owner in `HIRING_OWNERS`. */
  hiringOwner: string;
  stage: 'defining_rubric' | 'collecting_evidence' | 'round_1';
  /** The rubric's "What success means". */
  successStatement: string;
  /**
   * Weights total 100. `approvedOn` is a UTC date; null while the hiring owner has not approved this version.
   * `changeNote` says what changed from the version it supersedes.
   */
  rubric: { version: number; approvedOn: string | null; changeNote?: string; competencies: CastCompetency[] };
  /** The approved version the current one replaced, now superseded (version 2 jobs only). */
  supersedes?: { approvedOn: string; competencies: CastCompetency[] };
};
/** A rubric row as the Rubric and Add a job artboards show it; `suggested` marks "Suggested by Credalent, accepted". */
export type CastCompetency = {
  name: string;
  evidence: string;
  weight: number;
  level: 1 | 2 | 3 | 4 | 5;
  type: 'mandatory' | 'desirable';
  suggested?: true;
};
const row = (
  name: string,
  evidence: string,
  weight: number,
  level: CastCompetency['level'],
  type: CastCompetency['type'] = 'mandatory',
): CastCompetency => ({ name, evidence, weight, level, type });

/** A demo job in one industry (AIV-P1-065), seeded with a draft rubric v1 from its domain pack. */
export type CastIndustryJob = {
  title: string;
  jobType: string;
  /** A pack key of the published catalogue. */
  pack: string;
  /** Whose regional hints the rubric holds: a region key of the published catalogue. */
  region: string;
  team: string;
  location: string;
  /** `key` of the hiring owner in `HIRING_OWNERS`. */
  hiringOwner: string;
  /** The employer is described, never named (personas.md). */
  description: string;
};

export const WORKSPACE = {
  name: 'Demo',
  company: 'Demo Hiring Co',
  hiringFocus: 'several',
  synthetic: true,
} as const;

/** The signed-in recruiter of the design; the workspace's admin. */
export const RECRUITER: CastUser = { key: 'ap', displayName: 'AP', email: 'ap@example.com', synthetic: true };

const owner = (key: string, displayName: string): CastUser => ({
  key,
  displayName,
  email: `${key}@example.com`,
  synthetic: true,
});

export const HIRING_OWNERS: CastUser[] = [
  owner('head.engineering', 'Head of Engineering'),
  owner('cpo.payments', 'CPO, Payments'),
  owner('head.quality', 'Head of Quality'),
  owner('vp.engineering', 'VP Engineering'),
  owner('design.director', 'Design Director'),
];

// Evidence expected, levels and types from docs/01-design/artboards: Rubric.dc.html (Senior AI Engineer) and
// RoleNew.dc.html (the other four). Weights are personas.md's, not RoleNew's draft weights. The four success statements
// other than the Senior AI Engineer's are synthetic: no artboard shows them.
// shortcut: tests/e2e/seed.ts artboardRubric repeats these rows; keep both in step.
const SAE_V2: CastCompetency[] = [
  row('LLM systems in production', 'A shipped assistant or RAG system with real users, and their part in it', 25, 4),
  row('Retrieval and evaluation', 'Eval sets and retrieval metrics, and how they changed decisions', 20, 4),
  row('Python service engineering', 'Production Python they wrote: services, tests, deployment', 15, 3),
  row('Cost and reliability', 'Numbers on latency, cost per request and incidents handled', 15, 2, 'desirable'),
  {
    ...row(
      'Arabic and bilingual NLP',
      'Work on Arabic or bilingual text: models, evals, tokenisation',
      10,
      2,
      'desirable',
    ),
    suggested: true,
  },
  {
    ...row(
      'Product judgement',
      'Decisions made with product and business, shown in a doc or confirmed by a reference',
      15,
      3,
    ),
    suggested: true,
  },
];

export const JOBS: CastJob[] = [
  {
    title: 'Senior AI Engineer',
    jobType: 'ai_llm_engineering',
    team: 'Engineering',
    location: 'DIFC, Dubai',
    hiringOwner: 'head.engineering',
    stage: 'round_1',
    successStatement:
      'Within six months, a bilingual assistant that answers merchant questions in English and Arabic is live, ' +
      'measured against an evaluation set, and running within an agreed cost per request.',
    rubric: {
      version: 2,
      approvedOn: '2026-11-12',
      changeNote: 'Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
      competencies: SAE_V2,
    },
    // Version 1: Arabic NLP mandatory at 15%, Product judgement at 10%.
    supersedes: {
      approvedOn: '2026-11-05',
      competencies: SAE_V2.map((c) =>
        c.name === 'Arabic and bilingual NLP'
          ? { ...c, type: 'mandatory', weight: 15 }
          : c.name === 'Product judgement'
            ? { ...c, weight: 10 }
            : c,
      ),
    },
  },
  {
    title: 'Senior Product Manager, Payments',
    jobType: 'product_management',
    team: 'Product',
    location: 'Dubai Internet City',
    hiringOwner: 'cpo.payments',
    stage: 'round_1',
    successStatement:
      'Within six months, a payments feature they led is live with merchants, and its adoption and failure rates are ' +
      'measured against the targets agreed before launch.',
    rubric: {
      version: 1,
      approvedOn: '2026-11-05',
      competencies: [
        row('Discovery to decision', 'Research write-ups that show how evidence became a decision', 30, 4),
        row('Outcomes with metrics', 'Before-and-after numbers tied to something shipped', 30, 4),
        row('Prioritisation', 'A roadmap or trade-off document with the reasoning shown', 20, 3),
        row('Working with engineering and design', 'A reference showing how they ran the team day to day', 20, 3),
      ],
    },
  },
  {
    title: 'QA Automation Engineer',
    jobType: 'qa_test_automation',
    team: 'Quality',
    location: 'Dubai, hybrid',
    hiringOwner: 'head.quality',
    stage: 'collecting_evidence',
    successStatement:
      'Within six months, every release runs an automated regression suite they own, and escaped defects fall ' +
      'release on release.',
    rubric: {
      version: 1,
      approvedOn: '2026-11-09',
      competencies: [
        row('Test automation design', 'A test suite they wrote, and what it covers', 35, 4),
        row('Defect finding and reporting', 'Bug reports that led to fixes', 20, 4),
        row('CI and release quality', 'Pipelines and release checks they own', 25, 3),
        row('Test strategy and risk', 'A test plan that shows what they chose not to test, and why', 20, 3),
      ],
    },
  },
  {
    title: 'Staff Backend Engineer',
    jobType: 'software_engineering',
    team: 'Engineering',
    location: 'Riyadh, hybrid',
    hiringOwner: 'vp.engineering',
    stage: 'collecting_evidence',
    successStatement:
      'Within six months, a core service they designed runs in production within its agreed latency and error ' +
      'budgets, with the team able to change it safely.',
    rubric: {
      version: 1,
      approvedOn: '2026-11-10',
      competencies: [
        row(
          'System design in production',
          'A service they designed that runs in production, and the trade-offs they made',
          35,
          4,
        ),
        row('Code quality and testing', 'Code they wrote, with its tests and review history', 20, 4),
        row('Reliability and operations', 'Incidents they handled and the monitoring they set up', 25, 3),
        row('Delivery with a team', 'Shipped work, with their part confirmed by a reference', 20, 3),
      ],
    },
  },
  {
    title: 'Senior Product Designer',
    jobType: 'product_design',
    team: 'Design',
    location: 'Abu Dhabi',
    hiringOwner: 'design.director',
    stage: 'defining_rubric',
    successStatement:
      'Within six months, a redesigned core flow they led has shipped in English and Arabic, tested with users ' +
      'before and after launch.',
    rubric: {
      version: 1,
      approvedOn: null,
      competencies: [
        row('Interaction design craft', 'Design files or case studies showing flows, states and edge cases', 35, 4),
        row('Research to decisions', 'Research that changed a design', 25, 4),
        row('Design systems', 'Components or tokens they defined and maintained', 20, 3),
        row('Prototyping', 'A working prototype used to test an idea', 20, 3),
      ],
    },
  },
];

export const INDUSTRY_JOBS: CastIndustryJob[] = [
  {
    title: 'Senior Backend Engineer, Payments',
    jobType: 'software_engineering',
    pack: 'payments_fintech',
    region: 'uae',
    team: 'Engineering',
    location: 'DIFC, Dubai',
    hiringOwner: 'vp.engineering',
    description:
      'A card and wallet payments company is hiring a senior backend engineer to build the services that authorise, capture and settle payments for merchants across the region.',
  },
  {
    title: 'Integration Engineer, Health Records',
    jobType: 'forward_deployed_engineering',
    pack: 'healthcare',
    region: 'uae',
    team: 'Engineering',
    location: 'Abu Dhabi',
    hiringOwner: 'head.engineering',
    description:
      'A digital health company is hiring an integration engineer to connect hospital and clinic record systems to its platform, on site with each customer.',
  },
  {
    title: 'Data Engineer, Marketplace',
    jobType: 'data_ml',
    pack: 'ecommerce_marketplaces',
    region: 'ksa',
    team: 'Data',
    location: 'Riyadh',
    hiringOwner: 'vp.engineering',
    description:
      'An online marketplace is hiring a data engineer to build the pipelines behind search, recommendations and seller payouts.',
  },
  {
    title: 'SRE, Core Banking',
    jobType: 'devops_sre',
    pack: 'banking_islamic_finance',
    region: 'ksa',
    team: 'Platform',
    location: 'Riyadh, hybrid',
    hiringOwner: 'vp.engineering',
    description:
      'A retail bank is hiring a site reliability engineer to keep its core banking platform and the services around it available and safe to change.',
  },
  {
    title: 'QA Engineer, Payments',
    jobType: 'qa_test_automation',
    pack: 'payments_fintech',
    region: 'india',
    team: 'Quality',
    location: 'Bengaluru, hybrid',
    hiringOwner: 'head.quality',
    description:
      'A payments gateway is hiring a QA engineer to automate the tests that certify card and instant payment flows before each release.',
  },
];

/**
 * The job's draft rubric, as Add a job would build it with the industry chosen (AIV-P1-064): the job type's starter
 * competencies, then the pack's core competencies and its regional hints, each recording the pack and the version of
 * `catalogue` (the published one) that seeded it.
 * Weights need not total 100; the jobs module rebalances them when it saves the draft.
 * shortcut: repeats starterCompetencies and packCompetencies of apps/web job-new/domain/draft.ts (a tool cannot import an
 * app); move one builder into @credalent/jobs when either changes how a pack becomes rubric rows.
 */
export function industryRubric(
  { jobType, pack: key, region }: CastIndustryJob,
  catalogue: CatalogueVersion,
): Competency[] {
  const pack = packForJobType(catalogue, key, jobType);
  if (!pack) throw new Error(`No domain pack ${key}`);
  const starters: Competency[] = (catalogue.jobTypes.find((e) => e.key === jobType)?.starterCompetencies ?? []).map(
    (name) => ({
      name,
      evidenceExpected: '',
      weightPercent: 25,
      levelNeeded: 3,
      type: 'mandatory',
      origin: 'added_by_recruiter',
    }),
  );
  const fromPack: Competency[] = [...pack.core, ...pack.hints.filter((h) => h.region === region)].map((c) => ({
    name: c.name,
    evidenceExpected: c.evidence,
    weightPercent: 10,
    levelNeeded: c.levelNeeded,
    type: c.type,
    origin: 'domain_pack',
    packKey: key,
    packVersion: catalogue.version,
  }));
  return [...starters, ...fromPack.filter((c) => !starters.some((s) => nameKey(s.name) === nameKey(c.name)))];
}

const NAMES: [string, string][] = [
  // Senior AI Engineer
  ['Sara Al Qahtani', 'Dubai'],
  ['Arjun Menon', 'Dubai'],
  ['Layla Haddad', 'Sharjah'],
  ['Daniel Novak', 'Dubai'],
  ['Priya Nair', 'Abu Dhabi'],
  ['Omar Al Suwaidi', 'Dubai'],
  ['Maria Santos', 'Dubai'],
  // QA Automation Engineer, Senior Product Manager Payments, Staff Backend Engineer
  ['Hessa Al Mazrouei', 'Abu Dhabi'],
  ['Karim Nasser', 'Dubai'],
  ['Rana Khoury', 'Dubai'],
  ['Anjali Iyer', 'Dubai'],
  ['Tarek Mansour', 'Riyadh'],
  // Inbox arrivals
  ['Fatima Al Hammadi', 'Dubai'],
  ['Sneha Iyer', 'Bengaluru'],
  ['Anna Schmidt', 'Berlin'],
  ['Mark Reyes', 'Manila'],
  ['Youssef Aziz', 'Cairo'],
  ['Paolo Garcia', 'Dubai'],
  // Talent pool
  ['Hala Saleh', 'Amman'],
  ['Imran Qureshi', 'Dubai'],
  ['Kristine Dela Cruz', 'Dubai'],
  ['Lukas Schmidt', 'Munich'],
  ['Noura Al Ketbi', 'Abu Dhabi'],
];

/** `firstname.lastname@example.com`, as in the candidates tests. */
const emailOf = (name: string) =>
  `${name
    .toLowerCase()
    .replace(/ (al|dela) /, ' $1')
    .replace(' ', '.')}@example.com`;

export const CANDIDATES: CastCandidate[] = NAMES.map(([displayName, location], i) => ({
  displayName,
  email: emailOf(displayName),
  phone: `+447700900${String(i + 1).padStart(3, '0')}`,
  location,
  synthetic: true,
}));

/** One evidence source of a design candidate and the items it backs, each naming the rubric competency it backs. */
export type CastEvidence = {
  candidate: string;
  source: {
    kind: SourceKind;
    label: string;
    url?: string;
    capturedOn: string;
    checkedOn?: string;
    checkMethod?: string;
  };
  items: {
    competency: string;
    excerpt: string;
    excerptSpan?: string;
    provenance: Provenance;
    strength: Strength;
    limit: string;
  }[];
};

const repo = (handle: string, name: string) => `https://code.credalent.example/${handle}/${name}`;

/**
 * The Senior AI Engineer evidence of the three candidates the Candidate and Compare artboards show (Sara Al Qahtani
 * 68 up to 84, Arjun Menon 64 up to 76, Layla Haddad 61 up to 82), one item per competency the artboards cite. A
 * competency an artboard marks as having nothing stated (Arjun's Arabic NLP, Layla's cost and reliability) has no item.
 * Limits the artboards do not show are synthetic.
 */
export const EVIDENCE: CastEvidence[] = [
  {
    candidate: 'Sara Al Qahtani',
    source: { kind: 'shipped_product', label: 'Merchant help assistant', capturedOn: '2026-11-10' },
    items: [
      {
        competency: 'LLM systems in production',
        excerpt: 'used by about 9,000 merchants',
        provenance: 'corroborated',
        strength: 'strong',
        limit: 'The user count comes from her own write-up; the reference confirmed the scale only roughly.',
      },
    ],
  },
  {
    candidate: 'Sara Al Qahtani',
    source: {
      kind: 'repository',
      label: 'llm-eval-harness',
      url: repo('sara', 'llm-eval-harness'),
      capturedOn: '2026-11-10',
      checkedOn: '2026-11-12',
      checkMethod: 'Commit history',
    },
    items: [
      {
        competency: 'Retrieval and evaluation',
        excerpt: 'authored 412 of 460 commits',
        provenance: 'corroborated',
        strength: 'strong',
        limit: 'Shows the tooling, not how results changed product decisions.',
      },
    ],
  },
  {
    candidate: 'Sara Al Qahtani',
    source: {
      kind: 'repository',
      label: 'fastapi-ml-serve',
      url: repo('sara', 'fastapi-ml-serve'),
      capturedOn: '2026-11-10',
    },
    items: [
      {
        competency: 'Python service engineering',
        excerpt: 'contract tests on every endpoint and blue-green deploy scripts',
        provenance: 'submitted',
        strength: 'medium',
        limit: 'A personal project. Production code at her employer is private and was not seen.',
      },
    ],
  },
  {
    candidate: 'Sara Al Qahtani',
    source: { kind: 'reference_call', label: 'Reference call', capturedOn: '2026-11-11', checkedOn: '2026-11-11' },
    items: [
      {
        competency: 'Product judgement',
        excerpt: 'argued against a fully automatic refund bot and shipped suggest-then-confirm instead',
        provenance: 'corroborated',
        strength: 'medium',
        limit: 'One reference, no written decision document.',
      },
    ],
  },
  {
    candidate: 'Sara Al Qahtani',
    source: { kind: 'cv', label: 'CV', capturedOn: '2026-11-10' },
    items: [
      {
        competency: 'Cost and reliability',
        excerpt: 'cut cost per request by 40%',
        excerptSpan: 'page 2',
        provenance: 'claim',
        strength: 'supporting',
        limit: 'A claim until a document or a second source supports it.',
      },
    ],
  },
  {
    candidate: 'Sara Al Qahtani',
    source: { kind: 'interview_note', label: 'Round 1 notes', capturedOn: '2026-11-14' },
    items: [
      {
        competency: 'Arabic and bilingual NLP',
        excerpt: 'built a Gulf Arabic evaluation set',
        provenance: 'awaiting-defence',
        strength: 'claim',
        limit: 'Claim only. Counts as zero in the backed score.',
      },
    ],
  },
  {
    candidate: 'Arjun Menon',
    source: { kind: 'document', label: 'KYC document reader write-up', capturedOn: '2026-11-10' },
    items: [
      {
        competency: 'LLM systems in production',
        excerpt: 'KYC document reader in production',
        provenance: 'submitted',
        strength: 'strong',
        limit: 'His own write-up, with no second source.',
      },
    ],
  },
  {
    candidate: 'Arjun Menon',
    source: {
      kind: 'repository',
      label: 'eval-notebook',
      url: repo('arjun', 'eval-notebook'),
      capturedOn: '2026-11-10',
    },
    items: [
      {
        competency: 'Retrieval and evaluation',
        excerpt: 'retrieval evaluation notebook',
        provenance: 'submitted',
        strength: 'medium',
        limit: 'Authorship is shared with a colleague.',
      },
    ],
  },
  {
    candidate: 'Arjun Menon',
    source: {
      kind: 'repository',
      label: 'queue library',
      url: repo('arjun', 'queue'),
      capturedOn: '2026-11-10',
      checkedOn: '2026-11-12',
      checkMethod: 'Commit history',
    },
    items: [
      {
        competency: 'Python service engineering',
        excerpt: 'maintainer of an open-source queue library',
        provenance: 'corroborated',
        strength: 'strong',
        limit: 'Shows library code, not the services he runs at work.',
      },
    ],
  },
  {
    candidate: 'Arjun Menon',
    source: { kind: 'cv', label: 'CV', capturedOn: '2026-11-10' },
    items: [
      {
        competency: 'Cost and reliability',
        excerpt: 'on-call ownership',
        excerptSpan: 'page 1',
        provenance: 'claim',
        strength: 'supporting',
        limit: 'No incident record supplied.',
      },
    ],
  },
  {
    candidate: 'Arjun Menon',
    source: { kind: 'document', label: 'Decision document', capturedOn: '2026-11-10' },
    items: [
      {
        competency: 'Product judgement',
        excerpt: 'decision document supplied',
        provenance: 'submitted',
        strength: 'medium',
        limit: 'Authorship unverified.',
      },
    ],
  },
  {
    candidate: 'Layla Haddad',
    source: { kind: 'shipped_product', label: 'Support search prototype', capturedOn: '2026-11-10' },
    items: [
      {
        competency: 'LLM systems in production',
        excerpt: 'support search prototype with 300 pilot users',
        provenance: 'submitted',
        strength: 'medium',
        limit: 'A prototype with pilot users; production scale is unproven.',
      },
    ],
  },
  {
    candidate: 'Layla Haddad',
    source: {
      kind: 'repository',
      label: 'retrieval-benchmark',
      url: repo('layla', 'retrieval-benchmark'),
      capturedOn: '2026-11-10',
      checkedOn: '2026-11-12',
      checkMethod: 'Results reproduced',
    },
    items: [
      {
        competency: 'Retrieval and evaluation',
        excerpt: 'published retrieval benchmark',
        provenance: 'corroborated',
        strength: 'strong',
        limit: 'Shows benchmark work, not a production system.',
      },
    ],
  },
  {
    candidate: 'Layla Haddad',
    source: { kind: 'portal_submission', label: 'Service code sample', capturedOn: '2026-11-10' },
    items: [
      {
        competency: 'Python service engineering',
        excerpt: 'service code sample, tests present',
        provenance: 'submitted',
        strength: 'medium',
        limit: 'A sample she chose; the rest of her code was not seen.',
      },
    ],
  },
  {
    candidate: 'Layla Haddad',
    source: {
      kind: 'repository',
      label: 'arabic-ocr',
      url: repo('layla', 'arabic-ocr'),
      capturedOn: '2026-11-10',
      checkedOn: '2026-11-12',
      checkMethod: 'Commit history',
    },
    items: [
      {
        competency: 'Arabic and bilingual NLP',
        excerpt: 'Arabic OCR pipeline, public and documented',
        provenance: 'corroborated',
        strength: 'strong',
        limit: 'OCR work, not conversational Arabic.',
      },
    ],
  },
  {
    candidate: 'Layla Haddad',
    source: { kind: 'interview_note', label: 'Round 1 notes', capturedOn: '2026-11-14' },
    items: [
      {
        competency: 'Product judgement',
        excerpt: 'described in interview only',
        provenance: 'claim',
        strength: 'supporting',
        limit: 'A claim until a document or a reference supports it.',
      },
    ],
  },
];
