// Domain packs: the niche competencies of one industry, per job type (AIV-P1-061). Code, reviewed in PRs: no table.
import type { JobType } from './job-types.ts';

/** Bump when a pack entry changes meaning; kept pack competencies record the version that seeded them. */
export const DOMAIN_PACK_CATALOGUE_VERSION = 1;

/** Keys are stored with kept competencies (AIV-P1-064), so never rename one. */
export const DOMAIN_KEYS = ['payments_fintech', 'healthcare'] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export const REGIONS = ['uae', 'ksa', 'india'] as const;
export type Region = (typeof REGIONS)[number];

/** A skill shown with evidence. Never an employer, a nationality or where someone lives (AGENTS.md 1.5, 1.6). */
export type DomainCompetency = {
  readonly name: string;
  /** What it means, in one sentence. */
  readonly meaning: string;
  readonly evidence: string;
  readonly levels: { readonly 1: string; readonly 3: string; readonly 5: string };
  readonly appliesTo: readonly JobType[];
  /** Job types that get it as a default suggestion; at most 4 per job type per pack. */
  readonly core: readonly JobType[];
  /** Pack suggestions are never mandatory; the recruiter may raise one and the hiring owner approves. */
  readonly type: 'desirable';
  readonly levelNeeded: 2 | 3;
};

/** Knowledge of a market's rules or schemes, shown with evidence. The catalogue cannot make one mandatory. */
export type RegionalHint = Omit<DomainCompetency, 'core'>;

export type DomainPack = {
  readonly key: DomainKey;
  /** `packages/i18n` message key of the pack's name. */
  readonly labelKey: `domainPacks.${DomainKey}.label`;
  readonly competencies: readonly DomainCompetency[];
  readonly hints: Readonly<Record<Region, readonly RegionalHint[]>>;
};

/** One pack as one job type sees it: default suggestions, the rest of the pack, and regional hints. */
export type DomainPackForJobType = {
  readonly key: DomainKey;
  readonly labelKey: DomainPack['labelKey'];
  readonly core: readonly DomainCompetency[];
  readonly more: readonly DomainCompetency[];
  readonly hints: Readonly<Record<Region, readonly RegionalHint[]>>;
};

const desirable = 'desirable' as const;

const PAYMENTS_HINTS_APPLY_TO: JobType[] = [
  'software_engineering',
  'qa_test_automation',
  'forward_deployed_engineering',
  'product_management',
];
const HEALTHCARE_HINTS_APPLY_TO: JobType[] = [...PAYMENTS_HINTS_APPLY_TO, 'data_ml'];

// shortcut: competency text is English seed text copied into the recruiter's rubric, like the job type starters, not
// i18n keys; move it to `domainPacks.<key>.*` when the recruiter app ships in Arabic (AIV-P5-009).
const PACKS: DomainPack[] = [
  {
    key: 'payments_fintech',
    labelKey: 'domainPacks.payments_fintech.label',
    competencies: [
      {
        name: 'Idempotent payment APIs and retries',
        meaning: 'Makes sure a payment request that is retried, times out or arrives twice moves money exactly once.',
        evidence: 'Code with idempotency keys and retry tests; incident reviews of duplicate charges; design documents',
        levels: {
          1: 'Has called a payment API and handled declines',
          3: 'Built an endpoint where a retried charge is applied once, with tests that prove it',
          5: 'Designed retry, timeout and idempotency rules across services, with evidence a duplicate charge cannot happen under failure',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'devops_sre'],
        core: ['software_engineering'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'Ledger and double-entry accounting',
        meaning:
          'Records every money movement as balanced debit and credit entries in an append-only ledger, so any balance can be rebuilt and explained.',
        evidence:
          'Ledger schemas and posting code with balance invariants; posting and reversal tests; write-ups of balance discrepancies found and fixed',
        levels: {
          1: 'Has queried a ledger and can explain how one payment becomes a debit and a credit',
          3: 'Built postings, reversals and fees that always balance, with tests that check the invariant',
          5: 'Designed a multi-currency ledger with immutable entries and balances rebuilt from entries, running in production',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml'],
        core: ['software_engineering'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'Reconciliation and settlement',
        meaning:
          'Matches internal records against acquirer, scheme and bank settlement files, and clears breaks before money is lost or misreported.',
        evidence:
          'Reconciliation jobs and their matching rules; break reports and how they were cleared; settlement file parsers with tests',
        levels: {
          1: 'Has traced a mismatch between an internal record and a settlement report',
          3: 'Built an automated reconciliation that matches settlement files to transactions and reports breaks, with tests for partial and late settlement',
          5: 'Designed reconciliation across several acquirers, currencies and settlement cycles, with measured break rates and a process for clearing them',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'devops_sre'],
        core: ['software_engineering'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'PCI DSS scope reduction and tokenisation',
        meaning:
          'Keeps card data out of as many systems as possible with tokens, hosted fields or a vault, and knows what the remaining scope demands.',
        evidence:
          'Architecture diagrams that mark the cardholder data environment; tokenisation or vault integration code; assessment or self-assessment work',
        levels: {
          1: 'Can explain which card data is in scope and why it must never be logged or stored',
          3: 'Built a flow where raw card numbers never reach the team’s own servers, using tokens or hosted fields',
          5: 'Led a scope reduction that took systems out of the cardholder data environment, with the assessment evidence to show it',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'devops_sre'],
        core: ['software_engineering'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: '3-D Secure and SCA flows',
        meaning:
          'Integrates cardholder authentication so challenges, frictionless approvals, exemptions and failures are handled without losing good payments.',
        evidence:
          'Checkout code that handles each authentication result; test runs of challenge and frictionless cases; exemption or approval-rate analyses',
        levels: {
          1: 'Has integrated a checkout that triggers a 3-D Secure challenge',
          3: 'Handled challenge, frictionless, failed and abandoned authentication, with the liability shift recorded per payment',
          5: 'Designed an exemption and retry strategy across markets that raised approval rates within SCA rules, with before-and-after data',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'product_management',
          'product_design',
        ],
        core: [],
        type: desirable,
        levelNeeded: 2,
      },
      {
        name: 'Fraud and risk signals',
        meaning:
          'Scores payment risk from device, behaviour, velocity and transaction signals, and weighs fraud losses against good customers declined.',
        evidence:
          'Feature pipelines and rules; model evaluations with catch rate and false-decline rate; fraud incident analyses',
        levels: {
          1: 'Has written or tuned a velocity or blocklist rule',
          3: 'Built a risk score or rule set and measured its catch rate against false declines on labelled data',
          5: 'Owned rules, models and manual review in production, with chargeback and false-decline trends to show for it',
        },
        appliesTo: ['software_engineering', 'data_ml', 'ai_llm_engineering', 'product_management'],
        core: ['data_ml'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'Payment gateway and acquirer integration with webhooks',
        meaning:
          'Integrates gateways and acquirers so authorisations, captures, refunds and asynchronous webhook events stay consistent with the merchant’s records.',
        evidence:
          'Integration code for authorise, capture, refund and void; webhook handlers with signature checks and replay handling; certification records',
        levels: {
          1: 'Has integrated a gateway’s hosted checkout or client library',
          3: 'Built a server-side integration whose webhook handling is signed, idempotent and tested for out-of-order events',
          5: 'Designed routing across several acquirers with failover, keeping state consistent when webhooks arrive late, twice or never',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'devops_sre'],
        core: [],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'ISO 8583 and ISO 20022 messaging',
        meaning:
          'Reads, builds and maps card authorisation messages and account-to-account payment messages, including field rules, response codes and reversals.',
        evidence:
          'Message parsers or mappers with tests; switch or host integration code; mapping specifications between formats',
        levels: {
          1: 'Can read an ISO 8583 or ISO 20022 message and explain its key fields',
          3: 'Built a parser or mapper for one of the formats, with tests for bitmaps, field formats or schema validation',
          5: 'Designed a translation layer between card or bank networks and internal services, with response codes and reversals handled in production',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering'],
        core: [],
        type: desirable,
        levelNeeded: 2,
      },
      {
        name: 'Authorisation and conversion rates',
        meaning:
          'Reads the payment funnel from checkout to authorisation and settlement, finds where good payments fail, and moves the rate.',
        evidence: 'Before-and-after approval or conversion metrics; decline-code analyses; experiment write-ups',
        levels: {
          1: 'Can tell a decline from an authentication failure and an abandoned checkout',
          3: 'Shipped a change, such as retry rules, routing or a checkout step, that raised the approval rate, with the data to show it',
          5: 'Owned approval and conversion targets across markets and methods, with a record of decisions and their measured effect',
        },
        appliesTo: ['product_management', 'data_ml'],
        core: ['product_management'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'Scheme and regulatory rules',
        meaning:
          'Turns card scheme rules and payment regulation into product requirements before launch, not after an audit.',
        evidence:
          'Requirement documents that cite the rule they meet; compliance reviews; launch checklists for a new market or method',
        levels: {
          1: 'Knows which scheme and regulatory rules apply to the product and where to read them',
          3: 'Wrote requirements for a feature from a scheme or regulatory rule and saw it through review',
          5: 'Led a product through a licence, scheme or regulatory change, with the requirement trail and the outcome documented',
        },
        appliesTo: ['product_management'],
        core: ['product_management'],
        type: desirable,
        levelNeeded: 2,
      },
      {
        name: 'Payment methods by market',
        meaning:
          'Chooses and sequences cards, wallets, bank transfers, instant payments and cash-based methods for each market from usage and cost data.',
        evidence: 'Market analyses with method mix and cost; launch plans; adoption metrics after launch',
        levels: {
          1: 'Can describe the payment methods customers use in one market and what each costs to accept',
          3: 'Launched a payment method in a market and measured its adoption and cost',
          5: 'Set the payment method strategy across several markets, with adoption, cost and approval data behind each choice',
        },
        appliesTo: ['product_management', 'sales'],
        core: ['product_management'],
        type: desirable,
        levelNeeded: 2,
      },
      {
        name: 'Disputes and chargebacks',
        meaning:
          'Designs how disputes are received, evidenced and answered within scheme deadlines, and removes the causes that create them.',
        evidence: 'Dispute flow designs; win-rate and chargeback-ratio metrics; root-cause analyses',
        levels: {
          1: 'Can explain the chargeback lifecycle from first notice to arbitration',
          3: 'Improved a dispute process, such as evidence packs or deadline tracking, with a measured change in win rate or ratio',
          5: 'Kept chargeback ratios inside scheme thresholds across markets, with the programme and the data to show it',
        },
        appliesTo: ['product_management', 'data_ml', 'technical_writing_support'],
        core: ['product_management'],
        type: desirable,
        levelNeeded: 2,
      },
      {
        name: 'Payment certification and test cards',
        meaning:
          'Plans and runs the cases a gateway, acquirer or scheme requires before go-live, with test cards, simulators and response codes.',
        evidence:
          'Certification test plans and results; automated suites using scheme test cards and simulators; defect reports from certification runs',
        levels: {
          1: 'Has run payments through a sandbox with test cards and checked each result',
          3: 'Automated the certification cases for an integration, including declines, reversals and timeouts',
          5: 'Led certification for several acquirers or a new scheme, with test evidence accepted on first submission',
        },
        appliesTo: ['qa_test_automation', 'forward_deployed_engineering'],
        core: ['qa_test_automation'],
        type: desirable,
        levelNeeded: 3,
      },
    ],
    hints: {
      uae: [
        {
          name: 'CBUAE payment and stored-value rules',
          meaning:
            'Knows the CBUAE rules for retail payment services and stored-value facilities, and how they shape limits, safeguarding and onboarding.',
          evidence:
            'Requirement documents or compliance write-ups that apply the rules; integration code for features built to meet them',
          levels: {
            1: 'Can name the licence categories and what each allows',
            3: 'Built or specified a feature to meet a stored-value or payment-service rule, with the review trail',
            5: 'Led a product’s compliance with these rules through licensing or inspection, with the evidence pack',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
        {
          name: 'Aani instant payments',
          meaning:
            'Integrates account-to-account instant payments on Aani, including proxy lookup, request to pay and payment status handling.',
          evidence:
            'Integration code or sandbox certification work; payment flow designs with status and failure handling',
          levels: {
            1: 'Can explain how an Aani payment differs from a card payment',
            3: 'Built an Aani payment or request-to-pay flow in a sandbox, with status and failure cases tested',
            5: 'Took an Aani integration live and owned its reconciliation and incident handling',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
        {
          name: 'Local acquirer integration',
          meaning:
            'Integrates acquirers that serve the UAE market, including their certification, dirham settlement files and supported card brands.',
          evidence: 'Integration code and certification records; settlement file handling with tests',
          levels: {
            1: 'Has processed a test payment through an acquirer serving the UAE market',
            3: 'Built and certified an integration with one such acquirer, including its settlement files',
            5: 'Ran several such acquirer integrations in production, with routing and reconciliation across them',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'mada scheme integration',
          meaning: 'Accepts mada debit cards, including scheme certification, routing and co-badged card handling.',
          evidence: 'Integration code and certification test results; routing rules for co-badged cards',
          levels: {
            1: 'Can explain how mada cards are routed and how they differ from international card payments',
            3: 'Built and certified mada acceptance, including co-badged card routing',
            5: 'Owned mada acceptance in production across channels, with approval and reconciliation data',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
        {
          name: 'SADAD bill payments',
          meaning:
            'Integrates biller-side bill presentment and payment notifications for SADAD bill payments, and reconciles them.',
          evidence: 'Biller integration code; notification handlers with tests; reconciliation reports',
          levels: {
            1: 'Can explain the SADAD bill lifecycle from presentment to payment notification',
            3: 'Built bill upload and payment notification handling, with tests for duplicate and late notifications',
            5: 'Ran a SADAD biller integration in production, with reconciliation and exception handling owned',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
        {
          name: 'SAMA payment rules',
          meaning:
            'Knows the SAMA rules for payment service providers and how they shape licensing, onboarding, limits and reporting.',
          evidence: 'Requirement documents or compliance write-ups that apply the rules; features built to meet them',
          levels: {
            1: 'Can name the SAMA licence categories for payment services and what each allows',
            3: 'Built or specified a feature to meet a SAMA payment rule, with the review trail',
            5: 'Led a product’s compliance with SAMA payment rules through licensing or inspection, with the evidence pack',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'UPI and NPCI rules',
          meaning:
            'Integrates UPI collect, intent and mandate flows, and follows the NPCI operating rules for timeouts, status checks and disputes.',
          evidence:
            'UPI integration code with status-check and timeout tests; dispute handling flows; certification work',
          levels: {
            1: 'Can explain the difference between UPI collect, intent and mandate flows',
            3: 'Built a UPI flow with pending-status checks, timeouts and reversals tested',
            5: 'Ran UPI payments in production at volume, with success-rate, dispute and reconciliation data owned',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
        {
          name: 'RBI payment aggregator guidelines',
          meaning:
            'Knows the RBI payment aggregator rules, such as escrow handling, merchant due diligence and settlement timelines, and builds to them.',
          evidence:
            'Requirement documents or compliance write-ups that apply the guidelines; escrow or settlement code built to meet them',
          levels: {
            1: 'Can explain what the guidelines require of a payment aggregator',
            3: 'Built or specified escrow, settlement or merchant onboarding to meet the guidelines, with the review trail',
            5: 'Led a product’s compliance with the guidelines through authorisation or audit, with the evidence pack',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
        {
          name: 'Card-on-file tokenisation',
          meaning:
            'Replaces stored card numbers with network tokens for card-on-file payments, as the RBI rules require, including token lifecycle events.',
          evidence:
            'Token provisioning and lifecycle integration code with tests; network token certification work; migration plans from stored card numbers to tokens',
          levels: {
            1: 'Can explain why stored card numbers were replaced with tokens for card-on-file payments',
            3: 'Built token provisioning and payment with tokens, handling token updates and deletions',
            5: 'Led a migration of stored cards to tokens with no loss of repeat payments, with the data to show it',
          },
          appliesTo: PAYMENTS_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
      ],
    },
  },
  {
    key: 'healthcare',
    labelKey: 'domainPacks.healthcare.label',
    competencies: [
      {
        name: 'HL7 v2 messaging and FHIR R4 APIs',
        meaning:
          'Builds and maps clinical messages and resources, from HL7 v2 ADT and ORU feeds to FHIR R4 REST APIs and profiles.',
        evidence:
          'Interface code or mappings with tests; FHIR profiles or implementation guides used; validator results',
        levels: {
          1: 'Can read an HL7 v2 message and a FHIR resource and explain their main segments or elements',
          3: 'Built an interface that maps HL7 v2 messages to FHIR resources, or a FHIR API that passes a validator, with tests',
          5: 'Designed an integration layer for several message types, versions and profiles, with error queues and reprocessing in production',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'ai_llm_engineering',
        ],
        core: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'Clinical data privacy and consent',
        meaning:
          'Protects health information with role-based access, consent records, minimum necessary access and audit, as health data law requires.',
        evidence: 'Access control and consent designs; audit log implementations; privacy impact assessments',
        levels: {
          1: 'Knows what counts as protected health information and why it must never reach logs or test data',
          3: 'Built consent capture and access checks so a record is shown only to those allowed to see it, with audit entries',
          5: 'Designed privacy controls across a health platform, including emergency access, consent withdrawal and audit review, with assessment evidence',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'ai_llm_engineering',
          'devops_sre',
          'product_management',
          'product_design',
        ],
        core: ['software_engineering', 'data_ml', 'ai_llm_engineering', 'devops_sre', 'product_management'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'Clinical coding (ICD-10, CPT) and claims',
        meaning:
          'Works with diagnosis and procedure codes and the claim lifecycle, from eligibility and coding to submission, rejection and resubmission.',
        evidence: 'Claims or coding logic with tests; rejection analyses; data models for code sets and their versions',
        levels: {
          1: 'Can explain how a diagnosis code and a procedure code support a claim',
          3: 'Built claim validation or submission that reduced rejections, with the rejection data to show it',
          5: 'Designed a claims platform for several payers’ rules and code set updates, with measured rejection and turnaround rates',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'ai_llm_engineering',
          'product_management',
        ],
        core: ['data_ml', 'product_management'],
        type: desirable,
        levelNeeded: 2,
      },
      {
        name: 'Interoperability with EMR systems',
        meaning:
          'Connects products to electronic medical record systems through their interfaces, integration engines and launch frameworks such as SMART on FHIR.',
        evidence:
          'Integration code and interface specifications; go-live records from hospital deployments; integration engine configurations',
        levels: {
          1: 'Has worked with data sent to or exported from an EMR',
          3: 'Built and took live an integration with an EMR, handling patient matching and failed messages',
          5: 'Led integrations with several EMRs across hospitals, with a repeatable approach and support records',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'product_management'],
        core: ['software_engineering', 'forward_deployed_engineering'],
        type: desirable,
        levelNeeded: 3,
      },
      {
        name: 'Clinical safety and audit trails',
        meaning:
          'Identifies how software could harm a patient, records the hazards and their controls, and keeps a tamper-evident trail of clinical actions.',
        evidence: 'Hazard logs and safety cases; audit trail designs and tests; clinical incident reviews',
        levels: {
          1: 'Can explain why a change to a clinical record needs who, when and why',
          3: 'Built an audit trail for clinical actions and added hazards and controls to a safety case',
          5: 'Led clinical risk management for a product, with a hazard log, safety case and incident learning in use',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'ai_llm_engineering',
          'product_management',
          'product_design',
        ],
        core: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'ai_llm_engineering',
          'product_management',
        ],
        type: desirable,
        levelNeeded: 2,
      },
    ],
    hints: {
      uae: [
        {
          name: 'DHA NABIDH health information exchange',
          meaning:
            'Connects a facility or product to the NABIDH exchange, following the DHA onboarding, message and data standards.',
          evidence: 'Interface code and conformance results for NABIDH; onboarding or go-live records',
          levels: {
            1: 'Can explain what NABIDH exchanges and which standards it uses',
            3: 'Built an interface that passed NABIDH conformance testing',
            5: 'Led NABIDH onboarding for several facilities, with go-live and support records',
          },
          appliesTo: HEALTHCARE_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
        {
          name: 'DoH Malaffi health information exchange',
          meaning:
            'Connects a facility or product to the Malaffi exchange, following the DoH onboarding, message and data standards.',
          evidence: 'Interface code and conformance results for Malaffi; onboarding or go-live records',
          levels: {
            1: 'Can explain what Malaffi exchanges and which standards it uses',
            3: 'Built an interface that passed Malaffi conformance testing',
            5: 'Led Malaffi onboarding for several facilities, with go-live and support records',
          },
          appliesTo: HEALTHCARE_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'NPHIES eligibility, prior authorisation and claims',
          meaning:
            'Integrates with NPHIES for eligibility, prior authorisation and claims, using its FHIR profiles and code sets.',
          evidence: 'NPHIES integration code and validation results; claim rejection analyses; certification records',
          levels: {
            1: 'Can explain the NPHIES transaction types and how they map to FHIR resources',
            3: 'Built NPHIES eligibility or claim transactions that passed validation, with tests',
            5: 'Ran a NPHIES integration in production, with rejection rates and reprocessing owned',
          },
          appliesTo: HEALTHCARE_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'ABDM health IDs and consent',
          meaning:
            'Links ABHA health IDs and shares records through the ABDM consent manager and health information exchange flows.',
          evidence: 'ABDM integration code and sandbox certification; consent flow designs with tests',
          levels: {
            1: 'Can explain how an ABHA ID, a consent request and a record transfer fit together',
            3: 'Built ABHA linking or a consent-based record transfer that passed sandbox certification',
            5: 'Took an ABDM integration live as a health information provider or user, with consent and audit records owned',
          },
          appliesTo: HEALTHCARE_HINTS_APPLY_TO,
          type: desirable,
          levelNeeded: 2,
        },
      ],
    },
  },
];

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const CATALOGUE: readonly DomainPack[] = deepFreeze(PACKS);

/** Every pack, in catalogue order. Read-only. */
export const listDomainPacks = (): readonly DomainPack[] => CATALOGUE;

/** The pack as one job type sees it, or null for an unknown key. A job type the pack does not cover gets empty lists. */
export function getDomainPack(key: DomainKey, jobType: JobType): DomainPackForJobType | null {
  const pack = CATALOGUE.find((p) => p.key === key);
  if (!pack) return null;
  const applies = pack.competencies.filter((c) => c.appliesTo.includes(jobType));
  const hintsFor = (region: Region) => pack.hints[region].filter((h) => h.appliesTo.includes(jobType));
  return {
    key: pack.key,
    labelKey: pack.labelKey,
    core: applies.filter((c) => c.core.includes(jobType)),
    more: applies.filter((c) => !c.core.includes(jobType)),
    hints: { uae: hintsFor('uae'), ksa: hintsFor('ksa'), india: hintsFor('india') },
  };
}
