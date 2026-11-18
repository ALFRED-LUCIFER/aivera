// The synthetic demo cast (docs/00-product/personas.md, AIV-P0-031). Every person here is invented: emails are on the
// reserved example.com domain and phones are in Ofcom's drama range +44 7700 900000–900999, which never rings anyone.
// Module tickets seed from this file: candidates now; jobs, applications, evidence, interviews and packs when they land.
import type { JobType } from '@aivera/jobs';

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
  rubric: { version: number; approvedOn: string | null; competencies: { name: string; weight: number }[] };
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
