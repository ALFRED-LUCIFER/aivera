// Adapted from MIT-licensed code, © 2026 Santiago Fernández de Valderrama. Licence text: THIRD_PARTY_NOTICES.md.
//
// The engineering skill vocabulary and its canonical names (AIV-P1-072). Exact aliases only: no umbrella alias, so
// "cloud" never means AWS. Certifications and marketing terms are left out on purpose: a repository file scan cannot
// detect them, so they grade UNABLE TO VERIFY.

// prettier-ignore
const SKILL_TOKENS = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Ruby', 'Java', 'Golang', 'Rust', 'PHP',
  'Kotlin', 'Swift', 'Scala', 'Elixir', 'C\\+\\+', 'C#', '\\.NET', 'SQL',
  // Frameworks
  'React Native', 'React', 'Angular', 'Vue\\.?js', 'Svelte', 'Next\\.?js',
  'Django', 'Flask', 'FastAPI', 'Rails', 'Laravel', 'Symfony', 'Spring',
  'Node\\.?js', 'NodeJS',
  // Data stores
  'MongoDB', 'MySQL', 'PostgreSQL', 'Postgres', 'Redis', 'Elasticsearch',
  'Snowflake', 'BigQuery', 'Databricks', 'DynamoDB', 'Cassandra',
  // APIs and messaging
  'GraphQL', 'gRPC', 'Kafka', 'RabbitMQ',
  // Cloud and infrastructure
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'k8s', 'Terraform',
  'Ansible', 'Helm', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD',
  'Prometheus', 'Grafana', 'Datadog', 'Supabase', 'Inngest',
  // Data, ML and AI
  'PyTorch', 'TensorFlow', 'scikit-learn', 'Pandas', 'NumPy', 'Spark',
  'Airflow', 'dbt', 'MLOps', 'MLflow', 'LangChain', 'LlamaIndex',
  'Hugging Face', 'RAG', 'LLMs?', 'Prompt Engineering',
  'Computer Vision', 'NLP', 'Function Calling', 'Tool Calling',
  'HuggingFace', 'sklearn',
  'Retrieval-Augmented Generation', 'Retrieval Augmented Generation',
  'Large Language Models?', 'Natural Language Processing',
  // Testing
  'JUnit', 'TestNG', 'NUnit', 'xUnit', 'MSTest', 'Cucumber', 'Mockito',
  'Jest', 'pytest', 'Selenium', 'Playwright', 'Cypress', 'Karate', 'Postman',
  'TDD', 'BDD',
  // Observability
  'OpenTelemetry', 'OTel', 'ELK', 'Splunk', 'CloudWatch',
];

// (?<!\w) and (?!\w) instead of \b, which fails at symbol edges (C++, C#, .NET).
const SKILL_PATTERN = new RegExp(`(?<!\\w)(?:${SKILL_TOKENS.join('|')})(?!\\w)`, 'gi');

// "Go" is an everyday word: only the exact capitalised token counts, and not "Go-to-market" or "Go-live".
const GO_PATTERN = /(?<!\w)Go(?![\w-])/;

// Fine-tuning counts only where it names the ML skill: a list entry of its own, "model(s)" right beside it, or a model
// skill on the same line. "Fine-tuning PostgreSQL queries" is everyday work.
const FINE_TUNING = /(?<!\w)fine[- ]?tuning(?!\w)/i;
const MODEL_FINE_TUNING = /(?<!\w)models?\s+fine[- ]?tuning(?!\w)|(?<!\w)fine[- ]?tuning\s+(?:of\s+)?models?(?!\w)/i;
// Captured, so split() keeps each separator; a piece closed by a colon is a label, not an entry.
const LIST_SEPARATOR = /([,;:|/()[\]"•·])/;
const FINE_TUNING_ENTRY = /^(?:[-*+]\s+)?[*_]*fine[- ]?tuning[*_.]*$/i;
// prettier-ignore
const MODEL_SKILLS = new Set([
  'PyTorch', 'TensorFlow', 'scikit-learn', 'MLOps', 'MLflow', 'LangChain',
  'LlamaIndex', 'Hugging Face', 'RAG', 'LLMs', 'Prompt Engineering', 'Computer Vision', 'NLP',
]);

/** Lower case → display casing, from the tokens with their regex syntax stripped ('Vue\\.?js' → 'Vue.js'). */
const DISPLAY = new Map(
  SKILL_TOKENS.map((t) => {
    const display = t.replace(/\\/g, '').replace(/\?/g, '');
    return [display.toLowerCase(), display];
  }),
);

/** Spellings of the same skill only. */
const ALIASES = new Map(
  Object.entries({
    k8s: 'Kubernetes',
    golang: 'Go',
    postgres: 'PostgreSQL',
    nodejs: 'Node.js',
    'node.js': 'Node.js',
    vuejs: 'Vue.js',
    'vue.js': 'Vue.js',
    nextjs: 'Next.js',
    'next.js': 'Next.js',
    llm: 'LLMs',
    llms: 'LLMs',
    finetuning: 'Fine-tuning',
    'fine-tuning': 'Fine-tuning',
    'fine tuning': 'Fine-tuning',
    'github actions': 'GitHub Actions',
    'gitlab ci': 'GitLab CI',
    'ci/cd': 'CI/CD',
    'hugging face': 'Hugging Face',
    huggingface: 'Hugging Face',
    'react native': 'React Native',
    'prompt engineering': 'Prompt Engineering',
    'computer vision': 'Computer Vision',
    'scikit-learn': 'scikit-learn',
    sklearn: 'scikit-learn',
    'c++': 'C++',
    'c#': 'C#',
    '.net': '.NET',
    nlp: 'NLP',
    rag: 'RAG',
    sql: 'SQL',
    aws: 'AWS',
    gcp: 'GCP',
    grpc: 'gRPC',
    dbt: 'dbt',
    mlops: 'MLOps',
    mlflow: 'MLflow',
    otel: 'OpenTelemetry',
    'large language model': 'LLMs',
    'large language models': 'LLMs',
    'retrieval-augmented generation': 'RAG',
    'retrieval augmented generation': 'RAG',
    'natural language processing': 'NLP',
  }),
);

/**
 * The canonical name of one token ('k8s' → 'Kubernetes', 'graphql' → 'GraphQL'); an unknown token comes back
 * unchanged. `languageOf` resolves a bare extension-named language ('go' → 'Go') given explicitly as a target.
 */
export function canonicalizeToken(token: string, languageOf?: (key: string) => string | undefined): string {
  const key = token.toLowerCase();
  return ALIASES.get(key) ?? DISPLAY.get(key) ?? languageOf?.(key) ?? token;
}

function listsFineTuning(line: string): boolean {
  const parts = line.split(LIST_SEPARATOR);
  for (let i = 0; i < parts.length; i += 2)
    if (parts[i + 1] !== ':' && FINE_TUNING_ENTRY.test((parts[i] ?? '').trim())) return true;
  return false;
}

function mentionsFineTuning(text: string): boolean {
  return text
    .split('\n')
    .some(
      (line) =>
        FINE_TUNING.test(line) &&
        (MODEL_FINE_TUNING.test(line) ||
          listsFineTuning(line) ||
          [...line.matchAll(SKILL_PATTERN)].some((m) => MODEL_SKILLS.has(canonicalizeToken(m[0])))),
    );
}

/** The canonical skills a free text names. Matching fixed patterns is all it does with the text. */
export function extractSkills(text: string | null | undefined): Set<string> {
  const found = new Set<string>();
  if (!text) return found;
  for (const m of text.matchAll(SKILL_PATTERN)) found.add(canonicalizeToken(m[0]));
  if (GO_PATTERN.test(text)) found.add('Go');
  if (mentionsFineTuning(text)) found.add('Fine-tuning');
  return found;
}
