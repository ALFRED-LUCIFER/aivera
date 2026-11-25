// The synthetic demo cast (docs/00-product/personas.md, AIV-P0-031). Every person here is invented: emails are on the
// reserved example.com domain and phones are in Ofcom's drama range +44 7700 900000–900999, which never rings anyone.
// Module tickets seed from this file: candidates, industry jobs, the design jobs, evidence and the ongoing interviews
// with their applications now; the other applications and packs when they land.
import type { Provenance, SourceKind, Strength } from '@credalent/evidence';
import type { Round } from '@credalent/interviews';
import { nameKey, packForJobType, type CatalogueVersion, type Competency } from '@credalent/jobs';

type Synthetic = { synthetic: true };
export type CastUser = Synthetic & {
  key: string;
  displayName: string;
  email: string;
  /** Their job title in the workspace, shown where the app names a member by role ("CPO, Payments", personas.md). */
  title?: string;
};
export type CastCandidate = Synthetic & { displayName: string; email: string; phone: string; location: string };
export type CastJob = {
  title: string;
  jobType: string;
  team: string;
  location: string;
  /** `key` of the hiring owner in `HIRING_OWNERS`. */
  hiringOwner: string;
  /** Two paragraphs, as the recruiter would paste them; the employer is described, never named. */
  description: string;
  /** The UTC date the job was added, on or before its first rubric approval. */
  addedOn: string;
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
/** "Evidence expected" for the job types' starter competencies the industry jobs use (catalogue-v1.json). */
const STARTER_EVIDENCE: Record<string, string> = {
  'System design in production': 'A service they designed that runs in production, and the trade-offs they made',
  'Code quality and testing': 'Code they wrote, with its tests and review history',
  'Reliability and operations': 'Incidents they handled and the monitoring they set up',
  'Delivery with a team': 'Shipped work, with their part confirmed by a reference',
  'Customer problem discovery': 'Notes or a write-up showing how they found the real problem on a customer site',
  'Shipping in the customer environment':
    'A deployment into a customer system they did not control, and what went wrong',
  'Integration engineering': 'An integration they built between two systems, with its tests and mappings',
  'Working with AI systems': 'A feature or workflow where they used a model, and how they checked its output',
  'Problem framing': 'A brief or design note that turned a business question into a data problem',
  'Modelling and evaluation': 'A model or analysis with the metrics used to judge it and what they changed',
  'Data quality and pipelines': 'Pipelines they built, with the checks that catch late or wrong data',
  Experimentation: 'An experiment they designed, its result, and the decision that followed',
  'Infrastructure as code': 'Infrastructure they defined in code, with its review and change history',
  'Incident response': 'Incidents they led, with timelines and the follow-up actions',
  Observability: 'Dashboards and alerts they set up, and an issue they found with them',
  'Automation and tooling': 'Tools or scripts they wrote that removed manual work, and who uses them',
  'Test automation design': 'A test suite they wrote, and what it covers',
  'Defect finding and reporting': 'Bug reports that led to fixes',
  'CI and release quality': 'Pipelines and release checks they own',
  'Test strategy and risk': 'A test plan that shows what they chose not to test, and why',
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
  name: 'Meridian Talent',
  company: 'Meridian Digital',
  hiringFocus: 'several',
  synthetic: true,
} as const;

/** The signed-in recruiter of the design ("AP", a talent partner); the workspace's admin. */
export const RECRUITER: CastUser = {
  key: 'ap',
  displayName: 'Ayesha Perera',
  email: 'ap@example.com',
  synthetic: true,
};

const owner = (key: string, displayName: string, title: string): CastUser => ({
  key,
  displayName,
  title,
  email: `${key}@example.com`,
  synthetic: true,
});

export const HIRING_OWNERS: CastUser[] = [
  owner('head.engineering', 'Hassan Barakat', 'Head of Engineering'),
  owner('cpo.payments', 'Camille Fares', 'CPO, Payments'),
  owner('head.quality', 'Rashid Al Nuaimi', 'Head of Quality'),
  owner('vp.engineering', 'Vikram Deshmukh', 'VP Engineering'),
  owner('design.director', 'Dina Sabbagh', 'Design Director'),
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
    description:
      'Our merchants ask the same questions every day: why a payout is late, how a refund works, what a fee covers. ' +
      'We are building an assistant that answers them in English and Arabic, grounded in our own help content and ' +
      'merchant records, and we need a senior engineer to take it from a working prototype to a service people rely on.\n\n' +
      'You will own the retrieval and evaluation work, set up the evaluation sets that decide whether a change ships, ' +
      'and keep latency and cost per request inside agreed limits. You will work with product and support on what the ' +
      'assistant should refuse to answer. Production Python experience is essential; work on Arabic text is a plus.',
    addedOn: '2026-11-03',
    stage: 'round_1',
    successStatement:
      'A bilingual assistant that answers merchant questions in English and Arabic is live by the end of the second ' +
      'quarter, measured against an evaluation set and running within an agreed cost per request.',
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
    description:
      'We run a buy-now-pay-later product used at checkout by merchants across the Gulf, and the next release changes ' +
      'how failed and retried payments are handled. We are hiring a senior product manager to lead that work from ' +
      'research through launch.\n\n' +
      'You will talk to merchants and operations teams, turn what you hear into a clear decision, and agree the ' +
      'success targets with engineering and design before anything is built. We want someone who can show the numbers ' +
      'from products they shipped and explain the trade-offs they made along the way.',
    addedOn: '2026-11-02',
    stage: 'round_1',
    successStatement:
      'By the next payments release, a feature they led is live with merchants, and its adoption and failure rates are ' +
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
    description:
      'Releases go out every two weeks, and the regression checks still depend on a long manual script. We need a QA ' +
      'automation engineer to replace it with a suite the team trusts, starting with the checkout and onboarding flows.\n\n' +
      'You will design the suite, wire it into the pipeline so a failing check blocks the release, and keep it fast ' +
      'enough that developers run it. You will also write the test plan for each release, including what we choose ' +
      'not to test and why.',
    addedOn: '2026-11-06',
    stage: 'collecting_evidence',
    successStatement:
      'Every release runs an automated regression suite they own, and escaped defects fall release on release from ' +
      'their third release onward.',
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
    description:
      'Our ledger and settlement services carry every transaction we process and have outgrown the design they started ' +
      'with. We are hiring a staff backend engineer to redesign the core of them without a rewrite, one slice at a ' +
      'time, while they keep running.\n\n' +
      'You will set the technical direction, review the designs of the engineers around you, and be on the ' +
      'escalation path when something fails in production. We are looking for someone who has run a service with ' +
      'real traffic and can describe an incident they handled and what changed afterwards.',
    addedOn: '2026-11-04',
    stage: 'collecting_evidence',
    successStatement:
      'After two quarters on the team, a core service they designed runs in production within its agreed latency ' +
      'and error budgets, and the team can change it safely.',
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
    description:
      'The way merchants onboard and verify their business is the first thing they see of us, and it is slow and ' +
      'text-heavy. We are looking for a senior product designer to redesign that flow for English and Arabic, ' +
      'including right-to-left layouts.\n\n' +
      'You will run research with merchants, prototype and test options before committing to one, and contribute to ' +
      'our component library as you go. We care about how you reached a decision more than how the final screens ' +
      'look, so bring the reasoning behind your work.',
    addedOn: '2026-11-09',
    stage: 'defining_rubric',
    successStatement:
      'Half a year in, a redesigned core flow they led has shipped in English and Arabic, tested with users before ' +
      'and after launch.',
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
      'A card and wallet payments company is hiring a senior backend engineer for the team behind its authorisation and settlement services. Merchants across the region depend on them, and a duplicated or lost payment is the failure the team is organised around preventing.\n\nYou will design and run services that authorise, capture and settle payments, and take your turn on call. We are looking for someone who has built retry and idempotency handling for money movement and can explain how they reconciled the results.',
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
      "Hospitals and clinics sign up for our platform, and then somebody has to make it talk to the record systems they already run. This role is that person: part engineer, part guide, on site with each customer through go-live.\n\nExpect to map data between formats, test with the customer's own staff, and write down what you learned so the next integration is faster. Experience with health data standards helps, as does patience with legacy systems.",
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
      'Search ranking, recommendations and seller payouts at a large online marketplace all run on the same data, and it arrives late and untidy more often than anyone likes. We want a data engineer to make it dependable.\n\nYou will build and monitor pipelines, put checks on data quality where it enters, and work with analysts and machine learning engineers who depend on the output. Clear thinking about what a late or wrong number costs the business matters here.',
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
      'Customers of a retail bank expect their balance to be right and their app to open at any hour. The platform team is looking for a site reliability engineer to keep the core banking system and its neighbours available, and to make changes to them less frightening.\n\nYou will own monitoring and alerting, lead incident response, and automate the manual steps that cause outages. The bank is regulated, so you will also help show auditors how changes are controlled.',
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
      'A payments gateway needs every release certified against card and instant payment flows before it reaches merchants. The current checks take days, and the team wants them to take hours.\n\nAs QA engineer you will automate those checks, keep test data realistic without using real cards, and report defects in a way developers can act on the same day. Knowing how payment schemes and their test environments behave is a strong advantage.',
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
      evidenceExpected: STARTER_EVIDENCE[name] ?? '',
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
  ['Sneha Kulkarni', 'Bengaluru'],
  ['Anna Schmidt', 'Berlin'],
  ['Mark Reyes', 'Manila'],
  ['Youssef Aziz', 'Cairo'],
  ['Paolo Garcia', 'Dubai'],
  // Talent pool
  ['Hala Saleh', 'Amman'],
  ['Imran Qureshi', 'Dubai'],
  ['Kristine Dela Cruz', 'Dubai'],
  ['Lukas Brandt', 'Munich'],
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
 * Limits the artboards do not show are synthetic. Deviation (AIV-P1-094): the artboards show short labels; the excerpts
 * here are full synthetic sentences, so the demo reads as quoted evidence.
 */
export const EVIDENCE: CastEvidence[] = [
  {
    candidate: 'Sara Al Qahtani',
    source: {
      kind: 'shipped_product',
      label: 'Merchant help assistant',
      capturedOn: '2026-11-10',
      checkedOn: '2026-11-11',
      checkMethod: 'Reference call',
    },
    items: [
      {
        competency: 'LLM systems in production',
        excerpt: 'The assistant now handles first-line questions for about 9,000 merchants, in English and Arabic.',
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
        excerpt: "412 of the 460 commits in the repository are mine; the rest are two colleagues' dataset fixes.",
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
        excerpt:
          'Every endpoint has a contract test, and deploys go through a blue-green script that rolls back on a failed health check.',
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
        excerpt:
          'I argued against a refund bot that acts alone. We shipped suggestions that a support agent confirms with one click.',
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
        excerpt:
          'Reduced cost per request by 40% by caching retrieval results and routing simple questions to a smaller model.',
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
        excerpt:
          'I built a 600-question evaluation set in Gulf Arabic, written with native speakers on the support team.',
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
        excerpt:
          'The KYC document reader has run in production for 14 months and extracts fields from about 3,000 documents a week.',
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
        excerpt:
          'This notebook compares four retrieval setups on 250 labelled questions and reports recall at 5 for each.',
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
        excerpt:
          'I have maintained this open-source queue library since 2023 and review every pull request that touches the scheduler.',
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
        excerpt: 'Owned the on-call rota for the document service and wrote its runbooks.',
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
        excerpt:
          'We chose to extract fields first and review exceptions by hand, because a wrong field costs more than a slow one.',
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
        excerpt:
          'The prototype has 300 pilot users across two support teams, and their average search time fell from four minutes to one.',
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
        excerpt: 'The benchmark covers 1,200 queries over five document sets, with scripts to reproduce every result.',
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
        excerpt:
          'The sample is a small ticket-routing service with unit tests, a Dockerfile and a README that explains each endpoint.',
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
        excerpt:
          'The pipeline reads scanned Arabic forms, corrects common letter confusions, and documents its error rate per document type.',
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
        excerpt: 'I would pick the smaller feature first, because we could measure it within a month.',
        provenance: 'claim',
        strength: 'supporting',
        limit: 'A claim until a document or a reference supports it.',
      },
    ],
  },
];

/**
 * One ongoing interview of the Interviews artboard (AIV-P2-001); the candidate's application to the job is seeded with it.
 * `day` counts from the day the seed runs and `time` is Gulf time (UTC+4), so the list reads as the artboard does on
 * that day: "today", in two days, a scorecard two days overdue.
 */
export type CastInterview = {
  candidate: string;
  job: string;
  round: Round;
  /** `key` of the interviewer in `HIRING_OWNERS`; the recruiter ("You") when absent. */
  interviewer?: string;
  day: number;
  time: string;
  /** Started by the interviewer: "In progress". */
  started?: true;
  /** Names in the job's approved rubric. */
  competencies: string[];
};

// Deviations from the artboard, whose payments rows name competencies the seeded rubric (personas.md) does not have:
// Karim Nasser's "Payments domain" is left out, and Anjali Iyer's "Stakeholder communication" is the rubric's
// "Working with engineering and design". Her "16 Nov" has no time on the artboard; 11:00 is synthetic.
export const INTERVIEWS: CastInterview[] = [
  {
    candidate: 'Daniel Novak',
    job: 'Senior AI Engineer',
    round: 'structured_screen',
    day: 0,
    time: '14:00',
    started: true,
    competencies: ['Retrieval and evaluation', 'Cost and reliability'],
  },
  {
    candidate: 'Priya Nair',
    job: 'Senior AI Engineer',
    round: 'structured_screen',
    day: 2,
    time: '10:30',
    competencies: ['LLM systems in production'],
  },
  {
    candidate: 'Rana Khoury',
    job: 'Senior Product Manager, Payments',
    round: 'structured_screen',
    day: 2,
    time: '15:00',
    competencies: ['Outcomes with metrics'],
  },
  {
    candidate: 'Karim Nasser',
    job: 'Senior Product Manager, Payments',
    round: 'evidence_defence',
    interviewer: 'cpo.payments',
    day: 3,
    time: '11:00',
    competencies: ['Prioritisation'],
  },
  {
    candidate: 'Anjali Iyer',
    job: 'Senior Product Manager, Payments',
    round: 'structured_screen',
    day: -2,
    time: '11:00',
    competencies: ['Working with engineering and design'],
  },
];
