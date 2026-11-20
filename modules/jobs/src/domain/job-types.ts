// The ten job types and the evidence that counts for each (AIV-P1-004). Code, reviewed in PRs; seeds catalogue version 1.

/** Bump when an entry changes meaning, so drafts can say which catalogue seeded them. */
export const JOB_TYPE_CATALOGUE_VERSION = 1;

/** In the design's order (PRODUCT.md). Keys are stored (workspace hiring focus), so never rename one. */
export const JOB_TYPES = [
  'software_engineering',
  'qa_test_automation',
  'ai_llm_engineering',
  'forward_deployed_engineering',
  'data_ml',
  'devops_sre',
  'product_management',
  'product_design',
  'sales',
  'technical_writing_support',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type JobTypeEntry = {
  readonly key: JobType;
  /** `packages/i18n` message key of the job type's name. */
  readonly labelKey: `jobTypes.${JobType}.label`;
  /** `packages/i18n` message key of "Evidence that counts for this job type". */
  readonly evidenceKey: `jobTypes.${JobType}.evidence`;
  /** Seed a job description's competencies; the recruiter keeps, edits or removes each. */
  readonly starterCompetencies: readonly [string, string, string, string];
};

// shortcut: starter competency names are English seed text copied into the recruiter's rubric, not i18n keys; move them
// to `jobTypes.<key>.starter` when the recruiter app ships in Arabic (AIV-P5-009).
const STARTER_COMPETENCIES: Record<JobType, JobTypeEntry['starterCompetencies']> = {
  software_engineering: [
    'System design in production',
    'Code quality and testing',
    'Reliability and operations',
    'Delivery with a team',
  ],
  qa_test_automation: [
    'Test automation design',
    'Defect finding and reporting',
    'CI and release quality',
    'Test strategy and risk',
  ],
  ai_llm_engineering: [
    'LLM systems in production',
    'Retrieval and evaluation',
    'Python service engineering',
    'Cost and reliability',
  ],
  forward_deployed_engineering: [
    'Customer problem discovery',
    'Shipping in the customer environment',
    'Integration engineering',
    'Working with AI systems',
  ],
  data_ml: ['Problem framing', 'Modelling and evaluation', 'Data quality and pipelines', 'Experimentation'],
  devops_sre: ['Infrastructure as code', 'Incident response', 'Observability', 'Automation and tooling'],
  product_management: [
    'Discovery to decision',
    'Outcomes with metrics',
    'Prioritisation',
    'Working with engineering and design',
  ],
  product_design: ['Interaction design craft', 'Research to decisions', 'Design systems', 'Prototyping'],
  sales: ['Closing sales', 'Prospecting and pipeline', 'Client relationships', 'Negotiation'],
  technical_writing_support: [
    'Clear task documentation',
    'Understanding the product',
    'Information structure',
    'Working from tickets and feedback',
  ],
};

export const JOB_TYPE_CATALOGUE: readonly JobTypeEntry[] = Object.freeze(
  JOB_TYPES.map((key) =>
    Object.freeze({
      key,
      labelKey: `jobTypes.${key}.label` as const,
      evidenceKey: `jobTypes.${key}.evidence` as const,
      starterCompetencies: Object.freeze(STARTER_COMPETENCIES[key]),
    }),
  ),
);
