// The synthetic demo cast (docs/00-product/personas.md, AIV-P0-031). Every person here is invented: emails are on the
// reserved example.com domain and phones are in Ofcom's drama range +44 7700 900000–900999, which never rings anyone.
// Module tickets seed from this file: candidates, industry jobs and the design jobs now; applications, evidence,
// interviews and packs when they land.
import {
  DOMAIN_PACK_CATALOGUE_VERSION,
  getDomainPack,
  JOB_TYPE_CATALOGUE,
  nameKey,
  type Competency,
  type DomainKey,
  type JobType,
  type Region,
} from '@aivera/jobs';

type Synthetic = { synthetic: true };
export type CastUser = Synthetic & { key: string; displayName: string; email: string };
export type CastCandidate = Synthetic & { displayName: string; email: string; phone: string; location: string };
export type CastJob = {
  title: string;
  jobType: JobType;
  team: string;
  location: string;
  /** `key` of the hiring owner in `HIRING_OWNERS`. */
  hiringOwner: string;
  stage: 'defining_rubric' | 'collecting_evidence' | 'round_1';
  /** Weights total 100. `approvedOn` is a UTC date; null while the hiring owner has not approved this version. */
  rubric: { version: number; approvedOn: string | null; competencies: CastCompetency[] };
  /** The approved version the current one replaced, now superseded (version 2 jobs only). */
  supersedes?: { approvedOn: string; competencies: CastCompetency[] };
};
type CastCompetency = { name: string; weight: number };

/** A demo job in one industry (AIV-P1-065), seeded with a draft rubric v1 from its domain pack. */
export type CastIndustryJob = {
  title: string;
  jobType: JobType;
  pack: DomainKey;
  /** Whose regional hints the rubric holds. */
  region: Region;
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

export const JOBS: CastJob[] = [
  {
    title: 'Senior AI Engineer',
    jobType: 'ai_llm_engineering',
    team: 'Engineering',
    location: 'DIFC, Dubai',
    hiringOwner: 'head.engineering',
    stage: 'round_1',
    rubric: {
      version: 2,
      approvedOn: '2026-11-12',
      competencies: [
        { name: 'LLM systems in production', weight: 25 },
        { name: 'Retrieval and evaluation', weight: 20 },
        { name: 'Python service engineering', weight: 15 },
        { name: 'Cost and reliability', weight: 15 },
        { name: 'Arabic and multilingual NLP', weight: 10 },
        { name: 'Delivery with a team', weight: 15 },
      ],
    },
    // Version 1: Arabic NLP at 15%, Delivery with a team at 10%.
    supersedes: {
      approvedOn: '2026-11-05',
      competencies: [
        { name: 'LLM systems in production', weight: 25 },
        { name: 'Retrieval and evaluation', weight: 20 },
        { name: 'Python service engineering', weight: 15 },
        { name: 'Cost and reliability', weight: 15 },
        { name: 'Arabic and multilingual NLP', weight: 15 },
        { name: 'Delivery with a team', weight: 10 },
      ],
    },
  },
  {
    title: 'Senior Product Manager, Payments',
    jobType: 'product_management',
    team: 'Product',
    location: 'Dubai Internet City',
    hiringOwner: 'cpo.payments',
    stage: 'round_1',
    rubric: {
      version: 1,
      approvedOn: '2026-11-05',
      competencies: [
        { name: 'Discovery to decision', weight: 30 },
        { name: 'Outcomes with metrics', weight: 30 },
        { name: 'Prioritisation', weight: 20 },
        { name: 'Working with engineering and design', weight: 20 },
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
    rubric: {
      version: 1,
      approvedOn: '2026-11-09',
      competencies: [
        { name: 'Test automation design', weight: 35 },
        { name: 'Defect finding and reporting', weight: 20 },
        { name: 'CI and release quality', weight: 25 },
        { name: 'Test strategy and risk', weight: 20 },
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
    rubric: {
      version: 1,
      approvedOn: '2026-11-10',
      competencies: [
        { name: 'System design in production', weight: 35 },
        { name: 'Code quality and testing', weight: 20 },
        { name: 'Reliability and operations', weight: 25 },
        { name: 'Delivery with a team', weight: 20 },
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
    rubric: {
      version: 1,
      approvedOn: null,
      competencies: [
        { name: 'Interaction design craft', weight: 35 },
        { name: 'Research to decisions', weight: 25 },
        { name: 'Design systems', weight: 20 },
        { name: 'Prototyping', weight: 20 },
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
 * competencies, then the pack's core competencies and its regional hints, each recording the pack and its version.
 * Weights need not total 100; the jobs module rebalances them when it saves the draft.
 * shortcut: repeats starterCompetencies and packCompetencies of apps/web job-new/domain/draft.ts (a tool cannot import an
 * app); move one builder into @aivera/jobs when either changes how a pack becomes rubric rows.
 */
export function industryRubric({ jobType, pack: key, region }: CastIndustryJob): Competency[] {
  const pack = getDomainPack(key, jobType);
  if (!pack) throw new Error(`No domain pack ${key}`);
  const starters: Competency[] = (JOB_TYPE_CATALOGUE.find((e) => e.key === jobType)?.starterCompetencies ?? []).map(
    (name) => ({
      name,
      evidenceExpected: '',
      weightPercent: 25,
      levelNeeded: 3,
      type: 'mandatory',
      origin: 'added_by_recruiter',
    }),
  );
  const fromPack: Competency[] = [...pack.core, ...pack.hints[region]].map((c) => ({
    name: c.name,
    evidenceExpected: c.evidence,
    weightPercent: 10,
    levelNeeded: c.levelNeeded,
    type: c.type,
    origin: 'domain_pack',
    packKey: key,
    packVersion: DOMAIN_PACK_CATALOGUE_VERSION,
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
