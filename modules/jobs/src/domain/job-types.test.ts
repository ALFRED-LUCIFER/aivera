import { getTranslations } from '@aivera/i18n';
import { describe, expect, it } from 'vitest';
import { JOB_TYPE_CATALOGUE, JOB_TYPE_CATALOGUE_VERSION, JOB_TYPES } from '../contracts/index.ts';

// AIV-P1-004 Gherkin, read through the contracts entry as other modules do.
const t = await getTranslations('en', 'Asia/Dubai');
const byLabel = (label: string) => JOB_TYPE_CATALOGUE.find((entry) => t(entry.labelKey) === label);

describe('job types', () => {
  it.each([
    [
      'Software engineering',
      'Repositories, shipped products, code reviews',
      'System design in production; Code quality and testing; Reliability and operations; Delivery with a team',
    ],
    [
      'AI and LLM engineering',
      'Eval harnesses, prompt libraries, shipped assistants',
      'LLM systems in production; Retrieval and evaluation; Python service engineering; Cost and reliability',
    ],
    [
      'Sales',
      'Closed deals, client references, pipeline records, market write-ups',
      'Closing sales; Prospecting and pipeline; Client relationships; Negotiation',
    ],
    [
      'Forward deployed engineering',
      'Customer deployments, integration code, solution write-ups, customer references',
      'Customer problem discovery; Shipping in the customer environment; Integration engineering; Working with AI systems',
    ],
    [
      'QA and test automation',
      'Test suites, bug reports, CI history, test plans',
      'Test automation design; Defect finding and reporting; CI and release quality; Test strategy and risk',
    ],
    [
      'Data and machine learning',
      'Notebooks, evaluation sets, model cards, results write-ups',
      'Problem framing; Modelling and evaluation; Data quality and pipelines; Experimentation',
    ],
    [
      'DevOps and SRE',
      'Infrastructure code, incident reviews, runbooks',
      'Infrastructure as code; Incident response; Observability; Automation and tooling',
    ],
    [
      'Product management',
      'Requirement documents, discovery write-ups, before-and-after metrics',
      'Discovery to decision; Outcomes with metrics; Prioritisation; Working with engineering and design',
    ],
    [
      'Product design',
      'Case studies, design files, prototypes',
      'Interaction design craft; Research to decisions; Design systems; Prototyping',
    ],
    [
      'Technical writing and support',
      'Published documentation, resolved tickets, help articles',
      'Clear task documentation; Understanding the product; Information structure; Working from tickets and feedback',
    ],
  ])('%s states its evidence and starter competencies', (type, evidence, starter) => {
    const entry = byLabel(type);
    expect(entry && t(entry.evidenceKey)).toBe(evidence);
    expect(entry?.starterCompetencies.join('; ')).toBe(starter);
  });

  it('has exactly ten job types in the design order, with unique keys', () => {
    expect(JOB_TYPE_CATALOGUE.map((entry) => entry.key)).toEqual(JOB_TYPES);
    expect(new Set(JOB_TYPES).size).toBe(10);
    const labels = JOB_TYPE_CATALOGUE.map((entry) => t(entry.labelKey));
    expect([labels.at(0), labels.at(-1)]).toEqual(['Software engineering', 'Technical writing and support']);
  });

  it('translates every label and evidence key into English', () => {
    for (const { labelKey, evidenceKey } of JOB_TYPE_CATALOGUE)
      for (const key of [labelKey, evidenceKey]) expect(t(key), key).not.toBe(key);
  });

  it('is read-only and shows every change in review', () => {
    expect(Object.isFrozen(JOB_TYPE_CATALOGUE)).toBe(true);
    expect(JOB_TYPE_CATALOGUE.every((e) => Object.isFrozen(e) && Object.isFrozen(e.starterCompetencies))).toBe(true);
    expect({ version: JOB_TYPE_CATALOGUE_VERSION, catalogue: JOB_TYPE_CATALOGUE }).toMatchSnapshot();
  });
});
