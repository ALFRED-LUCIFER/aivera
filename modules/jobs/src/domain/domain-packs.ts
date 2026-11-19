// Domain packs: the niche competencies of one industry, per job type (AIV-P1-061). Code, reviewed in PRs: no table.
import type { JobType } from './job-types.ts';

/** Bump when a pack entry changes meaning; kept pack competencies record the version that seeded them. */
export const DOMAIN_PACK_CATALOGUE_VERSION = 1;

/** Keys are stored with kept competencies (AIV-P1-064), so never rename one. */
export const DOMAIN_KEYS = [
  'payments_fintech',
  'banking_islamic_finance',
  'healthcare',
  'ecommerce_marketplaces',
  'logistics_mobility',
  'government_public_sector',
  'telecom',
  'energy_utilities',
] as const;
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

const PAYMENTS_HINTS_APPLY_TO: JobType[] = [
  'software_engineering',
  'qa_test_automation',
  'forward_deployed_engineering',
  'product_management',
];
const HEALTHCARE_HINTS_APPLY_TO: JobType[] = [...PAYMENTS_HINTS_APPLY_TO, 'data_ml'];
const HINTS_APPLY_TO = HEALTHCARE_HINTS_APPLY_TO;
const SECURITY_HINTS_APPLY_TO: JobType[] = [...HINTS_APPLY_TO, 'devops_sre'];

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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'PCI DSS scope reduction and tokenisation',
        meaning:
          'Keeps card data out of as many systems as possible with tokens, hosted fields or a vault, and knows what the remaining scope demands.',
        evidence:
          'Architecture diagrams that mark the cardholder data environment; tokenisation or vault integration code; assessment or self-assessment work',
        levels: {
          1: 'Can explain which card data is in scope, why card numbers must never be logged, and why security codes must never be stored after authorisation',
          3: 'Built a flow where raw card numbers never reach the team’s own servers, using tokens or hosted fields',
          5: 'Led a scope reduction that took systems out of the cardholder data environment, with the assessment evidence to show it',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'devops_sre'],
        core: ['software_engineering'],
        type: 'desirable',
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
          5: 'Designed an exemption and retry strategy across markets that raised approval rates within each market’s authentication rules, with before-and-after data',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'product_management',
          'product_design',
        ],
        core: [],
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
    },
  },
  {
    key: 'banking_islamic_finance',
    labelKey: 'domainPacks.banking_islamic_finance.label',
    competencies: [
      {
        name: 'Core banking integration',
        meaning:
          'Connects channels and services to the core banking system for accounts, postings, holds and end-of-day processing, without breaking the books of record.',
        evidence:
          'Integration code against core banking interfaces with tests; designs for postings, holds and end-of-day cut-off; incident reviews of failed or duplicate postings',
        levels: {
          1: 'Has read account or transaction data through a core banking interface',
          3: 'Built a service that posts to a core banking system with idempotent retries and end-of-day cut-off handled, with tests',
          5: 'Designed the integration layer between digital channels and a core banking system, including an upgrade or migration with balances reconciled',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'devops_sre'],
        core: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'AML/CFT transaction monitoring',
        meaning:
          'Builds the scenarios, rules and alert workflows that flag suspicious transactions for investigators, and tunes them so alerts carry real risk rather than noise.',
        evidence:
          'Monitoring rules or models with test data; alert volume and true-positive analyses; case management workflow designs',
        levels: {
          1: 'Can explain typologies such as structuring and rapid movement of funds that a monitoring rule looks for',
          3: 'Built or tuned monitoring scenarios and measured alert volume and true-positive rate before and after',
          5: 'Owned transaction monitoring from typologies to alerts, cases and suspicious transaction reports, with model validation evidence',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'data_ml',
          'ai_llm_engineering',
          'product_management',
        ],
        core: ['software_engineering', 'data_ml', 'product_management'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'KYC, eKYC and sanctions screening',
        meaning:
          'Builds onboarding that verifies identity documents and liveness, screens names against sanctions and watch lists, and routes possible matches to review with each decision recorded.',
        evidence:
          'Onboarding flow code and tests; name-matching logic with test cases for spelling variants and transliterated Arabic names; review queue designs and audit records',
        levels: {
          1: 'Can explain customer due diligence, enhanced due diligence and why screening must handle name variants',
          3: 'Built an onboarding or screening flow with document checks, fuzzy name matching and a review queue, with tests for transliterated names',
          5: 'Designed onboarding and screening across products, with false-match rates measured and a decision trail that passed audit',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'product_management',
          'product_design',
        ],
        core: ['software_engineering', 'qa_test_automation', 'product_management'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Islamic finance products (murabaha, ijara) in systems',
        meaning:
          'Models Islamic finance contracts such as murabaha, ijara, musharaka and sukuk in systems, so profit, asset ownership, early settlement and late-payment charity follow the structure the Sharia board approved.',
        evidence:
          'Product and system designs that follow AAOIFI standards; profit schedule and early settlement code with tests; product reviews signed off by the Sharia board',
        levels: {
          1: 'Can explain how a murabaha sale differs from an interest-bearing loan, and what ijara means for who owns the asset',
          3: 'Built profit schedules, early settlement or ijara rentals for an Islamic finance product, with tests checked against the approved structure',
          5: 'Designed an Islamic finance product line in systems, such as sukuk or diminishing musharaka, with Sharia board and audit sign-off recorded',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'product_management'],
        core: ['software_engineering', 'product_management'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: 'Open banking APIs',
        meaning:
          'Publishes or consumes account information and payment initiation APIs with customer consent, strong authentication and the security profile the framework requires.',
        evidence:
          'API specifications and consent flow code; conformance or certification test results; security profile configuration such as mutual TLS and signed requests',
        levels: {
          1: 'Can explain account information, payment initiation and the consent a customer gives for each',
          3: 'Built an open banking API or client with consent, token handling and conformance tests passing',
          5: 'Led a bank’s open banking platform through certification, with consent management, monitoring and third-party onboarding',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'devops_sre',
          'product_management',
        ],
        core: ['forward_deployed_engineering', 'product_management'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: 'Basel and IFRS 9 risk reporting',
        meaning:
          'Builds the data and models behind expected credit loss, capital and liquidity reports, with lineage a regulator or auditor can follow back to the ledger.',
        evidence:
          'Expected credit loss, capital or liquidity calculation code; data lineage and reconciliation to the general ledger; model validation or audit findings closed',
        levels: {
          1: 'Can explain the three IFRS 9 stages and what probability of default, loss given default and exposure at default mean',
          3: 'Built an expected credit loss, capital or liquidity calculation that reconciles to the ledger, with tests',
          5: 'Owned a regulatory risk reporting pipeline through audit, with lineage, controls and model validation evidence',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'ai_llm_engineering'],
        core: ['data_ml'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Interest, profit and fee calculation testing',
        meaning:
          'Proves that interest, profit, fees and rounding are right across day counts, holidays, month ends and rate changes, before a customer or an auditor finds the error.',
        evidence:
          'Automated suites with boundary dates and rate changes; calculation defects found and their root causes; comparisons against an independent calculation',
        levels: {
          1: 'Can explain day-count conventions and why a month end or a holiday changes a calculation',
          3: 'Automated calculation tests over day counts, holidays and rate changes, and found a defect with them',
          5: 'Built the calculation test strategy for several products, with an independent model the bank uses as its check',
        },
        appliesTo: ['qa_test_automation', 'software_engineering'],
        core: ['qa_test_automation'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Operational resilience and change control',
        meaning:
          'Runs critical banking services with tested disaster recovery, controlled changes and segregation of duties, and keeps the evidence regulators and auditors accept.',
        evidence:
          'Disaster recovery test reports; change records with approvals and segregation of duties; outage reviews',
        levels: {
          1: 'Can explain why a production change at a bank needs approval, a rollback plan and segregation of duties',
          3: 'Ran a disaster recovery test or a controlled release with the evidence pack an auditor accepted',
          5: 'Designed resilience and change control for critical banking services, with recovery time targets met in tests',
        },
        appliesTo: ['devops_sre', 'software_engineering'],
        core: ['devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
    ],
    hints: {
      uae: [
        {
          name: 'CBUAE open finance framework',
          meaning:
            'Knows the CBUAE open finance framework, its consent, API and security standards, and builds account and payment services to them.',
          evidence:
            'Integration code or conformance results for the framework; consent flow designs; requirement documents that cite the standard they meet',
          levels: {
            1: 'Can explain what the framework covers and how a customer’s consent is captured and revoked',
            3: 'Built an API or client that passed the framework’s conformance tests, with consent handling tested',
            5: 'Took an open finance integration live and owned its consent, monitoring and incident handling',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'UAE PASS eKYC',
          meaning:
            'Uses UAE PASS sign-in and verified identity data in onboarding, with the consent, assurance levels and fallback the integration rules require.',
          evidence: 'Integration code and sandbox test results; onboarding flow designs with fallback cases',
          levels: {
            1: 'Can explain what verified data UAE PASS shares and what each assurance level means',
            3: 'Built onboarding with UAE PASS in a sandbox, with consent, failure and fallback cases tested',
            5: 'Took UAE PASS onboarding live and owned its completion rates and incident handling',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'CBUAE AML/CFT and suspicious transaction reporting',
          meaning:
            'Knows the CBUAE rules for AML/CFT controls and how suspicious transaction reports are filed with the financial intelligence unit, and builds monitoring and reporting to them.',
          evidence:
            'Requirement documents or compliance write-ups that apply the rules; reporting integration code or designs',
          levels: {
            1: 'Can explain when a suspicious transaction report is due and what it must contain',
            3: 'Built or specified monitoring or reporting to meet the rules, with the review trail',
            5: 'Led a bank’s AML/CFT systems through a regulatory inspection, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'SAMA open banking framework',
          meaning:
            'Knows the SAMA open banking framework, its account information and payment initiation standards, and builds services to them.',
          evidence:
            'Integration code or conformance results for the framework; consent flow designs; compliance write-ups that apply it',
          levels: {
            1: 'Can explain the phases of the framework and what each allows',
            3: 'Built an API or client that passed the framework’s conformance tests, with consent handling tested',
            5: 'Took an open banking integration live under the framework and owned its monitoring and incidents',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'Nafath identity verification',
          meaning:
            'Uses Nafath to verify identity and approve sign-ins and transactions in onboarding, including the app approval flow and its failure cases.',
          evidence:
            'Integration code and sandbox test results; onboarding flow designs with timeout and rejection cases',
          levels: {
            1: 'Can explain how a Nafath approval request reaches the customer and returns a result',
            3: 'Built Nafath verification in a sandbox, with timeout, rejection and retry cases tested',
            5: 'Took Nafath verification live and owned its completion rates and incident handling',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'SAMA Sharia governance framework',
          meaning:
            'Knows how the SAMA Sharia governance framework shapes product approval, review and audit for Islamic banking, and keeps systems and records in line with it.',
          evidence:
            'Product approval records and system controls that apply the framework; Sharia review or audit findings closed',
          levels: {
            1: 'Can explain the roles the framework gives the Sharia committee, review and audit',
            3: 'Built or specified system controls or records that a Sharia review relied on',
            5: 'Led systems work for a product through Sharia approval and audit, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'Account aggregator consent flows',
          meaning:
            'Integrates as a financial information provider or user in the RBI account aggregator framework, with consent artefacts, data fetch and revocation handled.',
          evidence:
            'Integration code and sandbox certification; consent flow designs with tests for revocation and expiry',
          levels: {
            1: 'Can explain how a consent artefact, a data fetch and a revocation fit together',
            3: 'Built a provider or user integration that passed sandbox certification, with consent expiry tested',
            5: 'Took an account aggregator integration live and owned its consent, data quality and audit records',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'Aadhaar eKYC and video KYC',
          meaning:
            'Builds onboarding with Aadhaar eKYC and video-based customer identification as the RBI KYC rules allow, with consent, masking and storage limits.',
          evidence:
            'Onboarding integration code with tests; designs for consent, number masking and storage; audit records',
          levels: {
            1: 'Can explain which eKYC and video KYC methods the RBI KYC rules allow and their limits',
            3: 'Built eKYC or video KYC onboarding with consent and masking, with the review trail',
            5: 'Ran eKYC or video KYC onboarding in production through audit, with completion and rejection data owned',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'RBI digital lending guidelines',
          meaning:
            'Knows the RBI digital lending guidelines, such as disbursal to the borrower’s own account, key fact statements and cooling-off periods, and builds lending flows to them.',
          evidence:
            'Requirement documents or compliance write-ups that apply the guidelines; lending flow code built to meet them',
          levels: {
            1: 'Can explain what the guidelines require of a lending app and its partners',
            3: 'Built or specified a lending flow to meet the guidelines, with the review trail',
            5: 'Led a lending product’s compliance with the guidelines through audit, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Clinical coding (ICD-10, CPT) and claims',
        meaning:
          'Works with diagnosis and procedure codes, or the market’s own code sets, and the claim lifecycle, from eligibility and coding to submission, rejection and resubmission.',
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
        type: 'desirable',
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
        type: 'desirable',
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
        type: 'desirable',
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
          type: 'desirable',
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
          type: 'desirable',
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
            5: 'Ran an NPHIES integration in production, with rejection rates and reprocessing owned',
          },
          appliesTo: HEALTHCARE_HINTS_APPLY_TO,
          type: 'desirable',
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
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
    },
  },
  {
    key: 'ecommerce_marketplaces',
    labelKey: 'domainPacks.ecommerce_marketplaces.label',
    competencies: [
      {
        name: 'Catalogue and search relevance',
        meaning:
          'Structures product data and tunes search so shoppers find the right item, including synonyms, typos, attributes and mixed-language queries.',
        evidence:
          'Search ranking code or configuration; offline relevance metrics and online experiment results; catalogue data quality work',
        levels: {
          1: 'Can explain how a product index, filters and ranking fit together',
          3: 'Improved search relevance with a measured change in click-through, zero-result rate or conversion',
          5: 'Owned search and catalogue quality across categories and languages, including Arabic and transliterated queries, with a relevance evaluation the team trusts',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'data_ml',
          'ai_llm_engineering',
          'product_management',
        ],
        core: ['software_engineering', 'data_ml', 'ai_llm_engineering'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Checkout and cart at peak load',
        meaning:
          'Keeps cart, pricing, stock reservation and checkout correct and fast during sale events, when traffic is many times normal.',
        evidence:
          'Load test plans and results; capacity and incident reviews from sale events; code for stock reservation and price consistency',
        levels: {
          1: 'Can explain why stock and price must be checked again at checkout',
          3: 'Load-tested a checkout to a sale-day target and fixed the bottleneck it found',
          5: 'Ran checkout through several peak sale events with error and latency targets met, and the capacity plan behind it',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'devops_sre', 'product_management'],
        core: ['software_engineering', 'qa_test_automation', 'devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Marketplace seller payouts',
        meaning:
          'Onboards and verifies sellers, then calculates commissions, fees, refunds and holds so each seller is paid the right amount on time.',
        evidence:
          'Payout and commission calculation code with tests; seller ledger designs; payout reconciliation reports',
        levels: {
          1: 'Can explain how a seller payout is built from orders, commission, refunds and fees',
          3: 'Built seller payout calculation with commission rules, refunds and holds, reconciled against payments',
          5: 'Designed seller onboarding and payouts at scale across currencies, with reconciliation and dispute data owned',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'product_management',
        ],
        core: ['software_engineering', 'product_management'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Cash on delivery reconciliation',
        meaning:
          'Reconciles cash collected by couriers against orders and remittances, and handles refused deliveries, partial payments and late remittance.',
        evidence: 'Reconciliation jobs and matching rules; remittance and break reports; refused-delivery analyses',
        levels: {
          1: 'Can explain the cash-on-delivery lifecycle from order to courier remittance',
          3: 'Built cash-on-delivery reconciliation that matched remittances to orders and reported breaks',
          5: 'Owned cash on delivery across couriers and markets, with refusal, remittance delay and loss data and the actions taken to reduce them',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'product_management'],
        core: ['software_engineering', 'data_ml'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Order management and returns',
        meaning:
          'Models the order lifecycle across split shipments, cancellations, returns and refunds, so stock, money and customer messages stay in step.',
        evidence: 'Order state machine code and tests; return and refund flow designs; return rate analyses',
        levels: {
          1: 'Can explain the states an order passes through from payment to delivery or return',
          3: 'Built order or return flows with split shipments and partial refunds, with tests for each transition',
          5: 'Designed order management across warehouses, sellers and carriers, with return rates and refund times measured and improved',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'product_management',
          'technical_writing_support',
        ],
        core: ['qa_test_automation', 'forward_deployed_engineering', 'product_management'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Checkout conversion and experimentation',
        meaning:
          'Finds where shoppers drop out of the funnel and runs controlled experiments that move conversion without hurting margin.',
        evidence: 'Experiment designs and results with sample sizes; funnel analyses; before-and-after conversion data',
        levels: {
          1: 'Can read a funnel and name the step where shoppers drop out',
          3: 'Ran a controlled experiment on a checkout or product page and shipped the winner, with the analysis to show it',
          5: 'Owned conversion targets across web and app, with an experimentation programme and documented results',
        },
        appliesTo: ['product_management', 'product_design', 'data_ml'],
        core: ['product_management', 'product_design', 'data_ml'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: 'Recommendations and personalisation',
        meaning:
          'Recommends products from browsing and purchase signals, and measures the lift against a fair baseline rather than clicks alone.',
        evidence: 'Recommender code or models; offline evaluations and online experiment results; cold-start handling',
        levels: {
          1: 'Can explain collaborative filtering and the cold-start problem',
          3: 'Built a recommender and measured its lift in an online experiment',
          5: 'Owned recommendations across surfaces, with evaluation, guardrails and measured revenue effect',
        },
        appliesTo: ['data_ml', 'ai_llm_engineering', 'software_engineering'],
        core: ['data_ml'],
        type: 'desirable',
        levelNeeded: 2,
      },
    ],
    hints: {
      uae: [
        {
          name: 'UAE VAT on e-commerce',
          meaning:
            'Applies UAE VAT to online sales, including tax invoices, credit notes for returns and marketplace rules, and keeps records in the form the tax authority asks for.',
          evidence: 'Tax calculation and invoice code with tests; requirement documents that cite the rule they meet',
          levels: {
            1: 'Can explain when an online sale needs a tax invoice and how a return changes it',
            3: 'Built tax invoices and credit notes for online sales, with tests and a review trail',
            5: 'Owned VAT handling for a marketplace through a tax audit, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'UAE e-invoicing (Peppol)',
          meaning:
            'Issues and receives structured e-invoices through an accredited service provider on the UAE network built on Peppol, with the tax data reported to the tax authority as the mandate requires.',
          evidence:
            'E-invoice generation or service provider integration code with tests; invoice data mappings; validation results',
          levels: {
            1: 'Can explain how an e-invoice moves between seller, service providers, buyer and the tax authority',
            3: 'Built e-invoice generation or a service provider integration that passed validation, with tests',
            5: 'Took e-invoicing live for a business at volume, with rejections and reporting owned',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'UAE e-commerce and consumer protection rules',
          meaning:
            'Knows the UAE rules for online selling and consumer protection, such as clear pricing in dirhams, return rights and seller disclosure, and builds checkout and listings to them.',
          evidence: 'Requirement documents or compliance write-ups that apply the rules; features built to meet them',
          levels: {
            1: 'Can name the main obligations the rules place on an online store',
            3: 'Built or specified a feature to meet one of the rules, with the review trail',
            5: 'Led a store’s compliance with the rules across checkout, listings and returns, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'ZATCA e-invoicing (Fatoora)',
          meaning:
            'Generates e-invoices that meet the ZATCA Fatoora requirements, including the XML format, QR codes, cryptographic stamps and clearance or reporting through the platform.',
          evidence: 'E-invoicing integration code and onboarding or compliance check results; invoice validation tests',
          levels: {
            1: 'Can explain the difference between clearance and reporting of an e-invoice',
            3: 'Built e-invoice generation that passed the platform’s compliance checks, with tests',
            5: 'Ran e-invoicing in production at volume, with rejections and reprocessing owned',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'GST invoicing and e-invoices',
          meaning:
            'Applies GST to marketplace sales, including tax collected at source by the marketplace, e-invoices registered on the invoice portal and the returns that follow.',
          evidence: 'Tax and e-invoice integration code with tests; reconciliation of invoices to returns',
          levels: {
            1: 'Can explain tax collected at source and when an e-invoice must be registered',
            3: 'Built GST e-invoice registration or marketplace tax collection, with tests and a review trail',
            5: 'Owned GST handling for a marketplace through audit, with reconciliation data',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'ONDC network integration',
          meaning:
            'Integrates a buyer or seller app with the ONDC network through its open protocol for search, order, fulfilment and settlement.',
          evidence: 'Protocol integration code and pre-production test results; settlement reconciliation designs',
          levels: {
            1: 'Can explain the roles of buyer apps, seller apps and the gateway on the network',
            3: 'Built a buyer or seller integration that passed the network’s pre-production tests',
            5: 'Took an integration live and owned its order, fulfilment and settlement data',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
    },
  },
  {
    key: 'logistics_mobility',
    labelKey: 'domainPacks.logistics_mobility.label',
    competencies: [
      {
        name: 'Route and dispatch optimisation',
        meaning:
          'Plans routes and assigns jobs to drivers or vehicles under time windows, capacity and traffic, and re-plans when the day changes.',
        evidence:
          'Routing or assignment code with benchmarks; before-and-after distance, cost or on-time data; solver configurations',
        levels: {
          1: 'Can explain the vehicle routing problem and why time windows make it harder',
          3: 'Built or tuned a routing or dispatch solver and measured its effect on distance, cost or on-time rate',
          5: 'Owned routing and dispatch in production at scale, including real-time re-planning, with measured savings',
        },
        appliesTo: ['software_engineering', 'data_ml', 'ai_llm_engineering', 'product_management'],
        core: ['software_engineering', 'data_ml'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Warehouse management systems',
        meaning:
          'Builds or integrates warehouse systems for receiving, putaway, picking, packing and cycle counts, so stock records match the shelves.',
        evidence: 'Warehouse system module or integration code; pick-path or slotting analyses; stock accuracy reports',
        levels: {
          1: 'Can explain the flow from receiving to dispatch in a warehouse',
          3: 'Built or integrated a warehouse flow such as picking or cycle counts, with tests and stock accuracy measured',
          5: 'Designed warehouse systems across sites, with throughput and stock accuracy targets met',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'product_management',
        ],
        core: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Real-time tracking and ETAs',
        meaning:
          'Ingests location events from vehicles and couriers, and predicts arrival times that customers and operations can trust.',
        evidence:
          'Event ingestion code; arrival-time model evaluations with error measures; incident reviews of tracking gaps',
        levels: {
          1: 'Can explain how location events become a shipment status and an estimated arrival time',
          3: 'Built tracking ingestion or an arrival-time model, with its error measured against actual arrivals',
          5: 'Owned real-time tracking at scale, with latency, gap and arrival-time error targets met',
        },
        appliesTo: ['software_engineering', 'data_ml', 'ai_llm_engineering', 'devops_sre', 'product_management'],
        core: ['software_engineering', 'data_ml', 'devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Carrier and customs integration',
        meaning:
          'Connects carriers and customs systems for bookings, labels, tracking events and customs declarations with harmonised system codes.',
        evidence: 'Carrier and customs integration code with tests; declaration mappings; rejection or hold analyses',
        levels: {
          1: 'Can explain what a customs declaration contains and why a harmonised system code matters',
          3: 'Built a carrier or customs integration with tests for rejections and holds',
          5: 'Designed integrations with many carriers and customs systems, with rejection and clearance times measured',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'product_management'],
        core: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'product_management'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Last-mile delivery and proof of delivery',
        meaning:
          'Designs the last-mile flow from dispatch to proof of delivery, failed attempts and returns, and measures first-attempt success.',
        evidence:
          'Driver and customer flow designs; first-attempt and failed-delivery analyses; proof-of-delivery data',
        levels: {
          1: 'Can explain why deliveries fail on the first attempt and what proof of delivery records',
          3: 'Shipped a change to the delivery flow that raised first-attempt success, with the data to show it',
          5: 'Owned last-mile delivery outcomes across cities, with a record of decisions and their measured effect',
        },
        appliesTo: ['product_management', 'product_design', 'software_engineering', 'data_ml'],
        core: ['product_management', 'product_design'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: 'Volume forecasting and capacity planning',
        meaning:
          'Forecasts shipment volume and plans fleet, drivers and warehouse shifts, so service levels hold at peak without idle capacity off-peak.',
        evidence: 'Forecast models with error measures; capacity plans; service-level and cost data after peaks',
        levels: {
          1: 'Can explain how a volume forecast turns into a fleet or shift plan',
          3: 'Built a volume forecast used for capacity planning, with its error measured',
          5: 'Owned forecasting and capacity planning across peaks, with service-level and cost results',
        },
        appliesTo: ['product_management', 'data_ml'],
        core: ['product_management', 'data_ml'],
        type: 'desirable',
        levelNeeded: 2,
      },
    ],
    hints: {
      uae: [
        {
          name: 'UAE customs and free-zone procedures',
          meaning:
            'Knows UAE customs declarations and free-zone procedures, such as transfers between a free zone and the mainland, transit and re-export, and builds them into systems.',
          evidence:
            'Customs integration code or declaration mappings; process designs with tests for each movement type',
          levels: {
            1: 'Can explain how goods moving from a free zone to the mainland differ from re-export',
            3: 'Built declarations or status handling for free-zone movements, with tests',
            5: 'Owned customs and free-zone flows in production, with clearance times and rejections measured',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'FASAH customs platform',
          meaning:
            'Integrates with the FASAH platform for customs clearance, import and export documents and shipment status, following its data and document requirements.',
          evidence: 'Integration code or document mappings; clearance status handling with tests',
          levels: {
            1: 'Can explain the clearance steps FASAH covers and the documents each needs',
            3: 'Built an integration or document flow for FASAH, with rejection cases tested',
            5: 'Owned FASAH clearance flows in production, with clearance times and rejections measured',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'E-way bill integration',
          meaning:
            'Generates and updates GST e-way bills for goods movement, including vehicle changes, validity extensions and cancellation, through the official APIs.',
          evidence: 'E-way bill integration code with tests; designs for vehicle change and extension cases',
          levels: {
            1: 'Can explain when an e-way bill is needed and what makes it invalid',
            3: 'Built e-way bill generation with vehicle updates and extensions, with tests',
            5: 'Ran e-way bill generation in production at volume, with failures and penalties tracked',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
    },
  },
  {
    key: 'government_public_sector',
    labelKey: 'domainPacks.government_public_sector.label',
    competencies: [
      {
        name: 'National digital identity sign-in',
        meaning:
          'Integrates sign-in and identity assurance from a government identity provider over OIDC or SAML, with assurance levels, consent and fallback handled.',
        evidence:
          'Identity integration code with tests for each assurance level; sign-in failure and fallback designs; security review records',
        levels: {
          1: 'Can explain how an OIDC or SAML sign-in works and what an assurance level means',
          3: 'Built sign-in with a government identity provider in a staging environment, with assurance, failure and fallback cases tested',
          5: 'Owned identity sign-in for several services in production, with completion rates, incidents and security reviews owned',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'devops_sre'],
        core: ['software_engineering', 'forward_deployed_engineering'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Arabic-first and accessible services',
        meaning:
          'Builds bilingual services that work right to left with Arabic as the first language, and that meet accessibility standards for screen readers, zoom and keyboard.',
        evidence:
          'Right-to-left layouts and bilingual content handling; WCAG 2.2 AA audits and fixes; test sessions with screen readers',
        levels: {
          1: 'Can explain what changes when a page switches to right to left, and how a WCAG success criterion is tested',
          3: 'Shipped a bilingual service with a right-to-left layout that passed a WCAG 2.2 AA audit',
          5: 'Set the bilingual and accessibility standard for several services, with audits, user testing and fixes tracked',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'product_management',
          'product_design',
          'technical_writing_support',
        ],
        core: [
          'software_engineering',
          'qa_test_automation',
          'product_management',
          'product_design',
          'technical_writing_support',
        ],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Data classification and security frameworks',
        meaning:
          'Classifies government data, applies the controls each class requires, and keeps the evidence an assessor checks against the applicable security framework.',
        evidence:
          'Classification schemes and control mappings; security assessment or audit evidence; remediation records',
        levels: {
          1: 'Can explain how data classes differ and which controls each class needs',
          3: 'Mapped a service’s controls to a security framework and closed the findings of its assessment',
          5: 'Led a platform through a security framework assessment, with control evidence kept current',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'devops_sre', 'product_management'],
        core: ['software_engineering', 'data_ml', 'devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Service integration across agencies',
        meaning:
          'Connects services across agencies through a government service bus or API gateway, with data sharing agreements, consent and audit.',
        evidence: 'Integration code and API specifications; data sharing designs; monitoring and audit records',
        levels: {
          1: 'Can explain why a service should fetch a record from another agency instead of asking for it again',
          3: 'Built an integration between agencies with consent and audit, with tests for failures and timeouts',
          5: 'Designed integration across several agencies, with data sharing agreements, monitoring and audit in production',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'devops_sre',
          'product_management',
        ],
        core: ['software_engineering', 'forward_deployed_engineering'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Public tender and service-level delivery',
        meaning:
          'Turns tender requirements, service-level agreements and government service standards into a delivery plan with acceptance evidence for each requirement.',
        evidence: 'Requirement traceability matrices; acceptance test records; service-level reports',
        levels: {
          1: 'Can read a tender’s requirements and say how each would be accepted',
          3: 'Delivered a public sector project against its requirements, with traceability and acceptance records',
          5: 'Led several public sector programmes from tender to acceptance, with service levels met and documented',
        },
        appliesTo: ['product_management', 'forward_deployed_engineering', 'technical_writing_support', 'sales'],
        core: ['product_management', 'sales'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: 'Life-event service design',
        meaning:
          'Designs public services around life events, measures completion and satisfaction, and removes steps and documents people should not have to provide twice.',
        evidence:
          'Service blueprints and journey maps; completion and satisfaction data before and after; research findings',
        levels: {
          1: 'Can explain how a life event spans several services and agencies',
          3: 'Redesigned a public service journey and measured the change in completion or time taken',
          5: 'Led the design of a life-event journey across agencies, with measured results',
        },
        appliesTo: ['product_design', 'product_management', 'data_ml'],
        core: ['product_design', 'product_management'],
        type: 'desirable',
        levelNeeded: 2,
      },
    ],
    hints: {
      uae: [
        {
          name: 'UAE PASS sign-in and digital signature',
          meaning:
            'Integrates UAE PASS for sign-in, verified identity data and digital signatures, following its onboarding and assurance-level rules.',
          evidence: 'Integration code and staging test results; signature flow designs; onboarding records',
          levels: {
            1: 'Can explain the UAE PASS assurance levels and what a digital signature through it proves',
            3: 'Built UAE PASS sign-in or signing in staging, with failure and fallback cases tested',
            5: 'Took UAE PASS sign-in and signing live across services, with completion and incident data owned',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'UAE information assurance standards',
          meaning:
            'Applies the UAE information assurance standards to a service, mapping its controls and keeping the evidence an assessment needs.',
          evidence: 'Control mappings and assessment evidence; remediation records',
          levels: {
            1: 'Can explain how the standards group controls and which apply to a service',
            3: 'Mapped a service to the standards and closed assessment findings',
            5: 'Led a platform through assessment against the standards, with evidence kept current',
          },
          appliesTo: SECURITY_HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'Nafath sign-in and approval',
          meaning:
            'Integrates Nafath for sign-in and transaction approval in government services, including the app approval flow and its failure cases.',
          evidence: 'Integration code and staging test results; designs for timeout and rejection cases',
          levels: {
            1: 'Can explain how a Nafath approval request reaches the person and returns a result',
            3: 'Built Nafath sign-in in staging, with timeout, rejection and retry cases tested',
            5: 'Took Nafath sign-in live across services, with completion and incident data owned',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'NCA essential cybersecurity controls (ECC)',
          meaning:
            'Applies the NCA essential cybersecurity controls to systems, mapping each control and keeping the evidence a compliance assessment needs.',
          evidence: 'Control mappings and compliance assessment evidence; remediation records',
          levels: {
            1: 'Can explain the main domains of the controls and which apply to a system',
            3: 'Mapped a system to the controls and closed the findings of its assessment',
            5: 'Led a platform through an assessment against the controls, with evidence kept current',
          },
          appliesTo: SECURITY_HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'DigiLocker issuer and requester APIs',
          meaning:
            'Issues or fetches verified documents through DigiLocker with the holder’s consent, using its issuer and requester APIs.',
          evidence: 'Integration code and sandbox test results; consent flow designs',
          levels: {
            1: 'Can explain how a document is issued to DigiLocker and fetched with consent',
            3: 'Built an issuer or requester integration in the sandbox, with consent and failure cases tested',
            5: 'Took a DigiLocker integration live, with issuance or fetch volumes and incidents owned',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'Aadhaar authentication',
          meaning:
            'Uses Aadhaar authentication or eKYC through an authorised agency under the UIDAI rules, with consent, number masking and storage limits.',
          evidence: 'Integration code with tests; designs for consent, masking and storage; audit records',
          levels: {
            1: 'Can explain the UIDAI rules for consent, masking and storing an Aadhaar number',
            3: 'Built Aadhaar authentication through an authorised agency, with consent and masking tested',
            5: 'Ran Aadhaar authentication in production through audit, with failure rates owned',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
    },
  },
  {
    key: 'telecom',
    labelKey: 'domainPacks.telecom.label',
    competencies: [
      {
        name: 'OSS/BSS systems',
        meaning:
          'Builds or integrates operations and business support systems for catalogue, order management, inventory, charging and assurance, so a sold service becomes a working one.',
        evidence: 'OSS or BSS integration code; order-to-activation flow designs; order fallout analyses',
        levels: {
          1: 'Can explain what OSS and BSS each cover and how an order moves between them',
          3: 'Built an order-to-activation flow across OSS and BSS, with fallout cases tested',
          5: 'Designed OSS and BSS integration for several products, with order fallout and activation times measured',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'devops_sre',
          'product_management',
        ],
        core: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'product_management'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'TM Forum Open APIs',
        meaning:
          'Exposes and consumes the standard TM Forum Open APIs for product catalogue, ordering, inventory and trouble tickets, so systems can be replaced without rewrites.',
        evidence:
          'API implementations and conformance results; mappings between internal models and the standard data model; integration tests',
        levels: {
          1: 'Can explain which TM Forum Open APIs cover catalogue, ordering and inventory',
          3: 'Built an implementation or client of one of the APIs that passed conformance tests',
          5: 'Designed an API layer on the standard APIs across several systems, with conformance and change records',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering'],
        core: ['software_engineering', 'forward_deployed_engineering'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: '5G core and network functions',
        meaning:
          'Builds, deploys or tests cloud-native network functions of a 5G core, such as AMF, SMF and UPF, and their service-based interfaces.',
        evidence:
          'Network function code, deployment charts or test results; interface traces; performance and failover test reports',
        levels: {
          1: 'Can explain the main 5G core network functions and what each does in a session',
          3: 'Built, deployed or tested a network function with traces and failover tests',
          5: 'Owned a 5G core deployment or product, with performance, failover and upgrade results',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'devops_sre'],
        core: ['software_engineering', 'qa_test_automation', 'devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Number portability and provisioning',
        meaning:
          'Handles number porting between operators, SIM and eSIM provisioning and service activation, within the deadlines the regulator sets.',
        evidence:
          'Porting and provisioning code with tests for rejections and rollbacks; activation time metrics; incident reviews',
        levels: {
          1: 'Can explain the steps of a port request and why it can be rejected',
          3: 'Built porting or eSIM provisioning with rejection and rollback cases tested',
          5: 'Owned porting and provisioning in production within regulatory deadlines, with activation data',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'product_management'],
        core: ['software_engineering', 'qa_test_automation'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Billing mediation and charging',
        meaning:
          'Collects usage records from the network, mediates and rates them, and turns them into correct charges, including roaming and interconnect.',
        evidence: 'Mediation or rating code with tests; usage record reconciliation; revenue assurance findings',
        levels: {
          1: 'Can explain how a usage record becomes a charge on a bill',
          3: 'Built mediation or rating rules with tests, and reconciled usage records against charges',
          5: 'Owned mediation and charging for several products, with revenue assurance findings closed',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'product_management'],
        core: ['data_ml', 'product_management'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Network automation',
        meaning:
          'Automates network configuration, provisioning and closed-loop fixes with NETCONF and YANG models, telemetry and orchestration instead of manual changes.',
        evidence:
          'Automation code and YANG models or templates; change failure rates before and after; orchestration runbooks',
        levels: {
          1: 'Can explain how a YANG model and NETCONF change a device’s configuration',
          3: 'Automated a network change or closed-loop fix and measured the change failure rate',
          5: 'Led network automation across domains, with manual changes and failures measured down',
        },
        appliesTo: ['software_engineering', 'devops_sre', 'data_ml', 'ai_llm_engineering'],
        core: ['devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Network quality and churn analytics',
        meaning:
          'Turns network counters, usage and customer data into churn, quality and capacity insights that operations and marketing act on.',
        evidence: 'Models or dashboards with evaluation; churn or quality analyses; decisions taken from them',
        levels: {
          1: 'Can explain the main network quality counters and how they relate to churn',
          3: 'Built a churn or quality model and measured its accuracy and the action it drove',
          5: 'Owned network and churn analytics, with models in production and measured results',
        },
        appliesTo: ['data_ml', 'ai_llm_engineering', 'product_management'],
        core: ['data_ml', 'product_management'],
        type: 'desirable',
        levelNeeded: 2,
      },
    ],
    hints: {
      uae: [
        {
          name: 'TDRA telecom rules',
          meaning:
            'Knows the TDRA rules for telecom services, such as number portability, consumer protection and subscriber registration, and builds features that meet them.',
          evidence: 'Requirement documents or compliance write-ups that apply the rules; features built to meet them',
          levels: {
            1: 'Can name the TDRA rules that apply to a product',
            3: 'Built or specified a feature to meet a TDRA rule, with the review trail',
            5: 'Led a product’s compliance with TDRA rules through review or inspection, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'CST telecom rules',
          meaning:
            'Knows the CST rules for telecom services, such as number portability, SIM registration with identity checks and quality-of-service reporting, and builds to them.',
          evidence: 'Requirement documents or compliance write-ups that apply the rules; features built to meet them',
          levels: {
            1: 'Can name the CST rules that apply to a product',
            3: 'Built or specified a feature to meet a CST rule, with the review trail',
            5: 'Led a product’s compliance with CST rules through review or inspection, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'TRAI and DoT rules',
          meaning:
            'Knows the TRAI and DoT rules, such as commercial message registration on DLT platforms, mobile number portability and subscriber verification, and builds to them.',
          evidence: 'Requirement documents or compliance write-ups that apply the rules; features built to meet them',
          levels: {
            1: 'Can explain how commercial messages are registered and filtered under the TRAI rules',
            3: 'Built or specified a feature to meet a TRAI or DoT rule, with the review trail',
            5: 'Led a product’s compliance with TRAI and DoT rules through audit, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
    },
  },
  {
    key: 'energy_utilities',
    labelKey: 'domainPacks.energy_utilities.label',
    competencies: [
      {
        name: 'OT and SCADA security (IEC 62443)',
        meaning:
          'Secures industrial control systems with zones and conduits, controlled remote access and monitoring that follow IEC 62443, without stopping the process.',
        evidence:
          'Zone and conduit designs; OT security assessments and remediation records; incident response playbooks for control systems',
        levels: {
          1: 'Can explain how OT security differs from IT security, and why availability and safety come first',
          3: 'Designed or implemented zones, conduits or remote access for a control system, with an assessment to show it',
          5: 'Led an OT security programme across sites, with assessments, monitoring and incident drills recorded',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'forward_deployed_engineering', 'devops_sre'],
        core: ['software_engineering', 'forward_deployed_engineering', 'devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Asset integrity and maintenance data',
        meaning:
          'Builds data and software for inspection, maintenance and asset health, so failures are predicted and integrity can be proven to auditors.',
        evidence:
          'Maintenance and inspection data models; reliability or predictive maintenance analyses; integrations with work management systems',
        levels: {
          1: 'Can explain the difference between planned, condition-based and predictive maintenance',
          3: 'Built a maintenance or inspection data flow, or a failure prediction measured against actual failures',
          5: 'Owned asset integrity data across a fleet of assets, with reliability gains and audit results',
        },
        appliesTo: [
          'software_engineering',
          'forward_deployed_engineering',
          'data_ml',
          'ai_llm_engineering',
          'product_management',
        ],
        core: ['software_engineering', 'data_ml'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'Smart metering and grid data',
        meaning:
          'Ingests and validates interval meter readings and grid telemetry at scale, from head-end systems to billing, outage and load analytics.',
        evidence:
          'Meter data pipelines with validation, estimation and editing (VEE) rules; time-series storage designs; data quality reports',
        levels: {
          1: 'Can explain how an interval reading travels from a meter to a bill',
          3: 'Built a meter data pipeline with VEE rules and data quality measured',
          5: 'Owned meter and grid data at the scale of millions of meters, with completeness and latency targets met',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'devops_sre', 'product_management'],
        core: ['software_engineering', 'data_ml', 'devops_sre'],
        type: 'desirable',
        levelNeeded: 3,
      },
      {
        name: 'HSE incident reporting systems',
        meaning:
          'Builds systems for reporting incidents, near misses and permits to work, so investigations, actions and safety metrics are complete and on time.',
        evidence:
          'Incident and permit-to-work system designs; workflow and notification tests; safety metric reports built from the data',
        levels: {
          1: 'Can explain the incident lifecycle from report to investigation and closed action',
          3: 'Built incident or permit-to-work flows with notifications and tests, used on site',
          5: 'Owned an HSE reporting platform across sites, with reporting rates and action closure measured',
        },
        appliesTo: ['software_engineering', 'qa_test_automation', 'data_ml', 'product_management', 'product_design'],
        core: ['software_engineering', 'product_management', 'product_design'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: 'Industrial protocols and historians',
        meaning:
          'Reads and writes field data over Modbus, DNP3, IEC 61850 or OPC UA, and stores it in process historians with timestamps and quality flags intact.',
        evidence: 'Protocol integration code with tests or simulators; historian configurations; data quality analyses',
        levels: {
          1: 'Can explain what a tag, a quality flag and a polling cycle are',
          3: 'Built an integration over one of the protocols into a historian, tested against a simulator',
          5: 'Designed field data acquisition across sites and protocols, with data quality and latency measured',
        },
        appliesTo: [
          'software_engineering',
          'qa_test_automation',
          'forward_deployed_engineering',
          'data_ml',
          'devops_sre',
        ],
        core: ['qa_test_automation', 'forward_deployed_engineering'],
        type: 'desirable',
        levelNeeded: 2,
      },
      {
        name: 'Load and renewable generation forecasting',
        meaning:
          'Forecasts demand and solar or wind output from weather and history, and states the error so grid and trading decisions can rely on it.',
        evidence: 'Forecast models with error measures by horizon; backtests; decisions taken from the forecasts',
        levels: {
          1: 'Can explain why forecast error matters more at some horizons than others',
          3: 'Built a load or generation forecast and measured its error against actuals',
          5: 'Owned forecasting used in grid or trading operations, with error targets met',
        },
        appliesTo: ['data_ml', 'ai_llm_engineering', 'product_management'],
        core: ['data_ml', 'product_management'],
        type: 'desirable',
        levelNeeded: 2,
      },
    ],
    hints: {
      uae: [
        {
          name: 'Abu Dhabi DoE regulatory rules',
          meaning:
            'Knows the DoE rules for the Abu Dhabi energy and water sector, such as metering codes, performance reporting and safety, and builds systems that meet them.',
          evidence: 'Requirement documents or compliance write-ups that apply the rules; systems built to meet them',
          levels: {
            1: 'Can name the DoE rules that apply to a system',
            3: 'Built or specified a system feature to meet a DoE rule, with the review trail',
            5: 'Led a system’s compliance with DoE rules through review or audit, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      ksa: [
        {
          name: 'WERA water and electricity rules',
          meaning:
            'Knows the WERA rules for water and electricity services, such as metering, connection and service-quality reporting, and builds systems that meet them.',
          evidence: 'Requirement documents or compliance write-ups that apply the rules; systems built to meet them',
          levels: {
            1: 'Can name the WERA rules that apply to a system',
            3: 'Built or specified a system feature to meet a WERA rule, with the review trail',
            5: 'Led a system’s compliance with WERA rules through review or audit, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
        {
          name: 'NCA operational technology controls (OTCC)',
          meaning:
            'Applies the NCA operational technology cybersecurity controls to industrial control systems, mapping each control and keeping the evidence an assessment needs.',
          evidence: 'Control mappings and assessment evidence for control systems; remediation records',
          levels: {
            1: 'Can explain how the OT controls extend the essential cybersecurity controls',
            3: 'Mapped a control system to the OT controls and closed assessment findings',
            5: 'Led sites through an assessment against the OT controls, with evidence kept current',
          },
          appliesTo: SECURITY_HINTS_APPLY_TO,
          type: 'desirable',
          levelNeeded: 2,
        },
      ],
      india: [
        {
          name: 'CEA metering and cybersecurity rules',
          meaning:
            'Knows the CEA regulations for metering, grid connectivity and power sector cybersecurity, and builds systems that meet them.',
          evidence:
            'Requirement documents or compliance write-ups that apply the regulations; systems built to meet them',
          levels: {
            1: 'Can name the CEA regulations that apply to a system',
            3: 'Built or specified a system feature to meet a CEA regulation, with the review trail',
            5: 'Led a system’s compliance with CEA regulations through audit, with the evidence pack',
          },
          appliesTo: HINTS_APPLY_TO,
          type: 'desirable',
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
