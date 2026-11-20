import { describe, expect, it } from 'vitest';
import { canonicalizeToken, extractSkills } from './vocabulary.ts';

const has = (text: string, ...skills: string[]) =>
  expect([...extractSkills(text)]).toEqual(expect.arrayContaining(skills));

describe('extractSkills', () => {
  it('canonicalises aliases: k8s, golang, Postgres and NodeJS', () => {
    const found = extractSkills('Needs k8s, golang and Postgres experience; NodeJS a plus');
    expect(found).toEqual(new Set(['Kubernetes', 'Go', 'PostgreSQL', 'Node.js']));
  });

  it('matches skills that end in a symbol: C++, C#, .NET and SQL', () => {
    has('Requires C++ and C# on .NET, plus SQL.', 'C++', 'C#', '.NET', 'SQL');
  });

  it('counts "Go" only as the capitalised standalone token, never prose, GO, Go-to-market or Go-live', () => {
    expect(extractSkills('Skills: Go, Rust, TypeScript').has('Go')).toBe(true);
    expect(extractSkills('Backend in Go/Rust (Go preferred).').has('Go')).toBe(true);
    expect(extractSkills('willing to go the extra mile; ready to GO live').has('Go')).toBe(false);
    expect(extractSkills('Own the Go-to-market strategy and Go-live support').has('Go')).toBe(false);
  });

  it('resolves lower-case mentions to canonical casing, and "Java" never swallows "JavaScript"', () => {
    has('familiar with graphql, pytorch and postgresql', 'GraphQL', 'PyTorch', 'PostgreSQL');
    expect(extractSkills('Expert in Java and AWS.')).toEqual(new Set(['Java', 'AWS']));
  });

  it('reads the testing, observability and AI/ML spellings', () => {
    has('Core Java, JUnit, Cucumber; TDD/BDD | Grafana, ELK, Splunk, CloudWatch', 'JUnit', 'Cucumber', 'TDD', 'BDD');
    has('Uses otel and pytest', 'OpenTelemetry', 'pytest');
    has('HuggingFace Transformers and sklearn', 'Hugging Face', 'scikit-learn');
    has('Large language models with retrieval-augmented generation', 'LLMs', 'RAG');
    has('Natural Language Processing', 'NLP');
  });

  it('stays off "small language models" and "natural language" prose', () => {
    expect(extractSkills('Experience with small language models on edge devices').has('LLMs')).toBe(false);
    expect(extractSkills('Answer natural language questions over the warehouse').has('NLP')).toBe(false);
  });

  it('reads fine-tuning only where it names the ML skill', () => {
    for (const text of [
      'Fine-tuning',
      'AI/ML: PyTorch, Hugging Face, Fine-tuning, RAG',
      '- **Fine-tuning** (LoRA, QLoRA)',
      'Experience fine-tuning LLMs for classification',
      'Experience with model fine-tuning, evaluation and deployment',
    ])
      expect(extractSkills(text).has('Fine-tuning'), text).toBe(true);
    for (const text of [
      'Fine-tuning the funnel to lift ROAS',
      'Fine-tuning PostgreSQL queries and indexes cut p95 latency by 40%',
      'Fine-tuning dbt models to cut warehouse spend',
      'Fine-tuning: dbt models to cut warehouse spend',
    ])
      expect(extractSkills(text).has('Fine-tuning'), text).toBe(false);
  });

  it('leaves out certifications and marketing terms, which a repository scan cannot detect', () => {
    expect(extractSkills('PMP, ITIL, SAFe, ABM and HubSpot')).toEqual(new Set());
  });

  it('returns an empty set for empty input', () => {
    expect(extractSkills('').size).toBe(0);
    expect(extractSkills(null).size).toBe(0);
  });
});

describe('canonicalizeToken', () => {
  it('maps aliases and display casing, and passes unknown tokens through unchanged (no umbrella alias)', () => {
    expect(canonicalizeToken('k8s')).toBe('Kubernetes');
    expect(canonicalizeToken('golang')).toBe('Go');
    expect(canonicalizeToken('graphql')).toBe('GraphQL');
    expect(canonicalizeToken('cloud')).toBe('cloud');
    expect(canonicalizeToken('SomeNicheFramework')).toBe('SomeNicheFramework');
  });

  it('reads Object.prototype names as unknown tokens', () => {
    expect(canonicalizeToken('constructor')).toBe('constructor');
    expect(canonicalizeToken('toString')).toBe('toString');
  });
});
