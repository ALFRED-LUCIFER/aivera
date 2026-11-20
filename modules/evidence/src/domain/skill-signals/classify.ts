// Adapted from MIT-licensed code, © 2026 Santiago Fernández de Valderrama. Licence text: THIRD_PARTY_NOTICES.md.
//
// Which skills a repository's files show (AIV-P1-072). Pure: the reader hands in the file listing and a bounded set of
// small files, and this turns them into per-skill signals and a grade per target skill:
//   STRONG            code-level evidence corroborated by a second signal kind or a second code-level file
//   PARTIAL           declaration-level evidence only (a manifest, a README, code under test or example folders), or
//                     one uncorroborated code-level file
//   NO_EVIDENCE       the listing was read completely and nothing was found: never evidence the skill is missing
//   UNABLE_TO_VERIFY  the skill is not detectable by a file scan, or coverage was incomplete
// Repository text is untrusted data: it is only matched against fixed patterns, so nothing it says can change a grade
// except by matching one.
import { canonicalizeToken, extractSkills } from './vocabulary.ts';

export const SKILL_GRADES = ['STRONG', 'PARTIAL', 'NO_EVIDENCE', 'UNABLE_TO_VERIFY'] as const;
export type SkillGrade = (typeof SKILL_GRADES)[number];

/** Why coverage was incomplete, first match wins in this order; null when the whole listing was covered. */
// rate_limited first: it is the only transient gap, and the files-only retry looks for it.
export const COVERAGE_GAPS = ['rate_limited', 'unreadable', 'truncated_listing', 'file_cap', 'oversized_file'] as const;
export type CoverageGap = (typeof COVERAGE_GAPS)[number];

export const GRADE_REASONS = [
  'code_corroborated',
  'code_files',
  'declaration_only',
  'single_code_file',
  'not_found',
  'not_detectable',
  ...COVERAGE_GAPS,
] as const;
export type GradeReason = (typeof GRADE_REASONS)[number];

export const SIGNAL_KINDS = ['manifest', 'config', 'path', 'readme'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_WEIGHTS = ['code', 'declaration'] as const;
export type SignalWeight = (typeof SIGNAL_WEIGHTS)[number];

/** One piece of evidence for a skill, from one file of the repository source it is stored under. */
export type SkillSignal = { skill: string; path: string; kind: SignalKind; weight: SignalWeight; detail: string };

/** How much of the repository was covered: the files counted (ignored paths never are) and the first gap, if any. */
export type Coverage = { filesInspected: number; gap: CoverageGap | null };

export type Citation = Omit<SkillSignal, 'skill'>;
export type SkillClassification = { skill: string; grade: SkillGrade; reason: GradeReason; citations: Citation[] };

export const MAX_FILES_PER_REPOSITORY = 15;
export const MAX_FILE_BYTES = 64 * 1024;
const MAX_CITATIONS = 6;
const MAX_DETAIL_LENGTH = 160;

// --- Paths ----------------------------------------------------------------------------------------------------------

/** Someone else's code or build output. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'vendor',
  'vendors',
  'third_party',
  'third-party',
  'bower_components',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  'site-packages',
  'coverage',
  '.next',
  '.nuxt',
]);

/** Code here says little about day-to-day use. */
const WEAK_DIRS =
  /^(?:tests?|__tests__|spec|specs|fixtures?|test-fixtures|examples?|samples?|demo|demos|mocks?|testdata)$/i;

const segments = (path: string) => path.split('/');
const basename = (path: string) => segments(path).at(-1) ?? '';
const depth = (path: string) => segments(path).length - 1;

/** Never read or counted: hidden segments (except `.github`), vendored and built folders, minified bundles. */
export function isIgnoredPath(path: string): boolean {
  const parts = segments(path);
  // Control and format characters (bidi overrides) in a path are never read, counted or stored.
  if (parts.some((p) => !p) || /[\p{Cc}\p{Cf}]/u.test(path)) return true;
  for (const dir of parts.slice(0, -1))
    if (IGNORED_DIRS.has(dir.toLowerCase()) || (dir.startsWith('.') && dir !== '.github')) return true;
  const file = parts.at(-1) ?? '';
  return file.startsWith('.') || /\.min\.(?:js|css)$/i.test(file);
}

/** Under a test, example, fixture or similar folder: declaration-level, not use. */
export const isWeakPath = (path: string) =>
  segments(path)
    .slice(0, -1)
    .some((dir) => WEAK_DIRS.test(dir));

const MANIFESTS = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'pipfile',
  'go.mod',
  'cargo.toml',
  'gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
]);
const COMPOSE = /^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/i;
const DOCKERFILE = /^Dockerfile(?:\.[\w-]+)?$|\.dockerfile$/i;
const README = /^readme(?:\.(?:md|markdown|rst|txt))?$/i;

type FileRole = 'readme' | 'manifest' | 'config';

function fileRole(path: string): FileRole | null {
  const file = basename(path);
  if (MANIFESTS.has(file.toLowerCase())) return 'manifest';
  if (DOCKERFILE.test(file) || COMPOSE.test(file)) return 'config';
  if (README.test(file) && depth(path) === 0) return 'readme';
  return null;
}

const ROLE_RANK: Record<FileRole, number> = { readme: 0, manifest: 1, config: 2 };

/**
 * The files worth reading, bounded: root README first, then manifests and container configs, shallowest first.
 * Ignored, weak and oversized paths are skipped before any read is spent on them.
 */
export function selectFiles(
  listing: readonly { path: string; size?: number | undefined }[],
  { maxFiles = MAX_FILES_PER_REPOSITORY, maxBytes = MAX_FILE_BYTES } = {},
): { selected: string[]; capped: boolean; oversized: string[] } {
  const oversized: string[] = [];
  const candidates: { path: string; role: FileRole }[] = [];
  for (const { path, size } of listing) {
    if (isIgnoredPath(path) || isWeakPath(path)) continue;
    const role = fileRole(path);
    if (!role) continue;
    if (size !== undefined && size > maxBytes) oversized.push(path);
    else candidates.push({ path, role });
  }
  candidates.sort(
    (a, b) => depth(a.path) - depth(b.path) || ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.path.localeCompare(b.path),
  );
  return {
    selected: candidates.slice(0, maxFiles).map((c) => c.path),
    capped: candidates.length > maxFiles,
    oversized,
  };
}

// --- Signals --------------------------------------------------------------------------------------------------------

/** Untrusted text made safe to store: control characters out, whitespace collapsed, at most 160 characters. */
export function cleanDetail(text: string): string {
  const chars = [
    ...text
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ];
  // Cut by code point, so a surrogate pair is never split.
  return chars.length > MAX_DETAIL_LENGTH ? `${chars.slice(0, MAX_DETAIL_LENGTH - 1).join('')}…` : chars.join('');
}

/** Source extensions → language. */
const EXTENSION_SKILLS = new Map(
  Object.entries({
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    jsx: 'JavaScript',
    ts: 'TypeScript',
    tsx: 'TypeScript',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    rb: 'Ruby',
    php: 'PHP',
    swift: 'Swift',
    scala: 'Scala',
    ex: 'Elixir',
    exs: 'Elixir',
    cs: 'C#',
    cpp: 'C++',
    cc: 'C++',
    hpp: 'C++',
    sql: 'SQL',
    tf: 'Terraform',
    vue: 'Vue.js',
    svelte: 'Svelte',
  }),
);

export const canonicalize = (token: string) => canonicalizeToken(token.trim(), (key) => EXTENSION_SKILLS.get(key));

// Code under a weak path is only ever declaration-level, whichever reader found it.
const signal = (skill: string, path: string, kind: SignalKind, weight: SignalWeight, detail: string): SkillSignal => ({
  skill: canonicalize(skill),
  path,
  kind,
  weight: weight === 'code' && isWeakPath(path) ? 'declaration' : weight,
  detail: cleanDetail(detail),
});

/**
 * Signals from file names alone: source files by extension (two files cited per language, test and example files
 * apart and declaration-level), Dockerfiles, compose files and GitHub Actions workflows.
 */
export function pathSignals(paths: readonly string[]): SkillSignal[] {
  const groups = new Map<string, { lang: string; weak: boolean; paths: string[] }>();
  const out: SkillSignal[] = [];
  for (const path of paths) {
    if (isIgnoredPath(path)) continue;
    const file = basename(path);
    if (DOCKERFILE.test(file)) out.push(signal('Docker', path, 'config', 'code', 'Dockerfile'));
    else if (COMPOSE.test(file)) out.push(signal('Docker', path, 'config', 'code', 'Compose file'));
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path))
      out.push(signal('GitHub Actions', path, 'config', 'code', 'GitHub Actions workflow'));
    const dot = file.lastIndexOf('.');
    const lang = dot > 0 ? EXTENSION_SKILLS.get(file.slice(dot + 1).toLowerCase()) : undefined;
    if (!lang) continue;
    const weak = isWeakPath(path) || /\.d\.[cm]?ts$/i.test(file);
    const key = `${lang}\u0000${weak}`;
    const group = groups.get(key) ?? { lang, weak, paths: [] };
    group.paths.push(path);
    groups.set(key, group);
  }
  for (const { lang, weak, paths: files } of groups.values()) {
    files.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
    const ext = basename(files[0] ?? '')
      .split('.')
      .pop();
    const detail = `${files.length} .${ext} file${files.length === 1 ? '' : 's'}${weak ? ' (test or example paths only)' : ''}`;
    // A .d.ts outside test folders is declaration-level too, so it says so itself rather than through the path.
    for (const file of files.slice(0, weak ? 1 : 2))
      out.push(signal(lang, file, 'path', /\.d\.[cm]?ts$/i.test(file) ? 'declaration' : 'code', detail));
  }
  return out;
}

/** Known packages per ecosystem; a package not listed is ignored, so manifests stay line-based reads. */
const PACKAGE_SKILLS: Record<string, Record<string, string>> = {
  npm: {
    pg: 'PostgreSQL',
    'pg-promise': 'PostgreSQL',
    postgres: 'PostgreSQL',
    redis: 'Redis',
    ioredis: 'Redis',
    mongoose: 'MongoDB',
    mongodb: 'MongoDB',
    mysql: 'MySQL',
    mysql2: 'MySQL',
    react: 'React',
    'react-native': 'React Native',
    next: 'Next.js',
    vue: 'Vue.js',
    '@angular/core': 'Angular',
    svelte: 'Svelte',
    typescript: 'TypeScript',
    graphql: 'GraphQL',
    kafkajs: 'Kafka',
    amqplib: 'RabbitMQ',
    'aws-sdk': 'AWS',
    '@elastic/elasticsearch': 'Elasticsearch',
    '@tensorflow/tfjs': 'TensorFlow',
    '@grpc/grpc-js': 'gRPC',
  },
  python: {
    psycopg2: 'PostgreSQL',
    'psycopg2-binary': 'PostgreSQL',
    psycopg: 'PostgreSQL',
    asyncpg: 'PostgreSQL',
    redis: 'Redis',
    django: 'Django',
    flask: 'Flask',
    fastapi: 'FastAPI',
    pymongo: 'MongoDB',
    torch: 'PyTorch',
    tensorflow: 'TensorFlow',
    boto3: 'AWS',
    'kafka-python': 'Kafka',
    pika: 'RabbitMQ',
    elasticsearch: 'Elasticsearch',
    mysqlclient: 'MySQL',
    pymysql: 'MySQL',
    grpcio: 'gRPC',
  },
  go: {
    'github.com/lib/pq': 'PostgreSQL',
    'github.com/jackc/pgx': 'PostgreSQL',
    'github.com/go-redis/redis': 'Redis',
    'github.com/redis/go-redis': 'Redis',
    'go.mongodb.org/mongo-driver': 'MongoDB',
    'google.golang.org/grpc': 'gRPC',
    'github.com/go-sql-driver/mysql': 'MySQL',
    'github.com/aws/aws-sdk-go': 'AWS',
    'github.com/segmentio/kafka-go': 'Kafka',
  },
  rust: { 'tokio-postgres': 'PostgreSQL', postgres: 'PostgreSQL', redis: 'Redis', mongodb: 'MongoDB', tonic: 'gRPC' },
  ruby: { pg: 'PostgreSQL', redis: 'Redis', rails: 'Rails', mysql2: 'MySQL', mongoid: 'MongoDB' },
  php: { 'laravel/framework': 'Laravel', 'symfony/symfony': 'Symfony', 'predis/predis': 'Redis' },
  jvm: {
    postgresql: 'PostgreSQL',
    'spring-boot': 'Spring',
    'spring-core': 'Spring',
    jedis: 'Redis',
    'kafka-clients': 'Kafka',
  },
};

const ECOSYSTEMS: Record<string, string> = {
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
  pipfile: 'python',
  'go.mod': 'go',
  'cargo.toml': 'rust',
  gemfile: 'ruby',
  'pom.xml': 'jvm',
  'build.gradle': 'jvm',
  'build.gradle.kts': 'jvm',
};

/** The language a manifest declares a project in (JVM manifests are left out: Java or Kotlin). */
const ECOSYSTEM_LANGUAGES: Record<string, string> = { python: 'Python', go: 'Go', rust: 'Rust', ruby: 'Ruby' };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const own = (table: Record<string, string>, key: string) => (Object.hasOwn(table, key) ? table[key] : undefined);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Go: only `require` directives add dependencies; `replace` and `exclude` do not. */
function goRequires(lines: string[]): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (inBlock) {
      if (/^\s*\)/.test(line)) inBlock = false;
      else kept.push(line);
    } else if (/^\s*require\s*\(/.test(line)) inBlock = true;
    else {
      const one = /^\s*require\s+(\S.*)$/.exec(line);
      if (one?.[1]) kept.push(one[1]);
    }
  }
  return kept.join('\n');
}

/** Signals from one dependency manifest; every one is declaration-level, since declaring a package is not using it. */
export function manifestSignals(path: string, text: string): SkillSignal[] {
  const file = basename(path).toLowerCase();
  const out: SkillSignal[] = [];
  const add = (skill: string, detail: string) => out.push(signal(skill, path, 'manifest', 'declaration', detail));
  if (file === 'package.json' || file === 'composer.json') {
    const json = parseJson(text);
    if (!isRecord(json)) return out;
    const table = file === 'package.json' ? PACKAGE_SKILLS['npm'] : PACKAGE_SKILLS['php'];
    for (const field of ['dependencies', 'devDependencies', 'require', 'require-dev']) {
      const deps = json[field];
      if (!isRecord(deps)) continue;
      for (const name of Object.keys(deps)) {
        const key = name.toLowerCase();
        const skill =
          (table && own(table, key)) ?? (file === 'package.json' && key.startsWith('@aws-sdk/') ? 'AWS' : undefined);
        if (skill) add(skill, `${field}: ${name}`);
      }
    }
    if (file === 'package.json') {
      const engines = json['engines'];
      const engine = isRecord(engines) && typeof engines['node'] === 'string' ? engines['node'] : null;
      const scripts = isRecord(json['scripts']) ? Object.values(json['scripts']) : [];
      if (engine !== null) add('Node.js', `engines.node: ${engine}`);
      else if (scripts.some((s) => typeof s === 'string' && /(?:^|[\s;&|])node\s+\S/.test(s)))
        add('Node.js', 'scripts run node');
    }
    return out;
  }
  const ecosystem = ECOSYSTEMS[file];
  const table = ecosystem && PACKAGE_SKILLS[ecosystem];
  if (!ecosystem || !table) return out;
  const language = ECOSYSTEM_LANGUAGES[ecosystem];
  if (language) add(language, `${basename(path)} declares a ${language} project`);
  const lines = text.split('\n').filter((l) => !/^\s*(?:#|\/\/)/.test(l));
  const body = ecosystem === 'go' ? goRequires(lines) : lines.join('\n');
  const tail = ecosystem === 'go' ? '(?:[/\\s"\'@]|$)' : '(?![\\w.-])';
  for (const [pkg, skill] of Object.entries(table))
    if (new RegExp(`(?<![\\w.@/-])${escapeRe(pkg)}${tail}`, 'im').test(body)) add(skill, `${file}: ${pkg}`);
  return out;
}

// Official Docker Hub images in their short, library/ and docker.io/ forms, tag- or digest-pinned.
const HUB = '(?:docker\\.io\\/)?(?:library\\/)?';
const END = '(?:[:@]|$)';
const IMAGE_SKILLS: [RegExp, string][] = [
  [new RegExp(`^${HUB}node${END}`, 'i'), 'Node.js'],
  [new RegExp(`^${HUB}python${END}`, 'i'), 'Python'],
  [new RegExp(`^${HUB}golang${END}`, 'i'), 'Go'],
  [new RegExp(`^${HUB}(?:postgres|postgis\\/postgis)${END}`, 'i'), 'PostgreSQL'],
  [new RegExp(`^${HUB}redis${END}`, 'i'), 'Redis'],
  [new RegExp(`^${HUB}mysql${END}`, 'i'), 'MySQL'],
  [new RegExp(`^${HUB}mongo${END}`, 'i'), 'MongoDB'],
  [new RegExp(`^${HUB}rabbitmq${END}`, 'i'), 'RabbitMQ'],
  [/elasticsearch(?:[:@]|$)/i, 'Elasticsearch'],
  [/kafka(?:[:@]|$)/i, 'Kafka'],
];

/**
 * `image:` values that are direct fields of a service under the top-level `services:` map, read line by line by
 * indentation (no YAML dependency): an `image:` nested deeper, or outside `services:`, is not a service image.
 */
function composeServiceImages(text: string): string[] {
  const images: string[] = [];
  let inServices = false;
  let serviceIndent: number | null = null;
  let fieldIndent: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    if (indent === 0) {
      inServices = /^services:\s*(?:#.*)?$/.test(line);
      serviceIndent = fieldIndent = null;
      continue;
    }
    if (!inServices) continue;
    serviceIndent ??= indent;
    if (indent <= serviceIndent) {
      fieldIndent = null;
      continue;
    }
    fieldIndent ??= indent;
    if (indent !== fieldIndent) continue;
    const image = /^\s*image:\s*["']?([^\s"'#]+)/i.exec(line)?.[1];
    if (image) images.push(image);
  }
  return images;
}

/** A Dockerfile's base images, skipping a FROM that names an earlier build stage. */
function dockerfileImages(text: string): string[] {
  const stages = new Set<string>();
  const images: string[] = [];
  for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?([^\s#]+)(?:\s+AS\s+([\w.-]+))?/gim)) {
    const image = m[1] ?? '';
    if (!stages.has(image.toLowerCase())) images.push(image);
    if (m[2]) stages.add(m[2].toLowerCase());
  }
  return images;
}

/** Signals from a Dockerfile or compose file: the images it builds on or runs. Code-level unless the path is weak. */
export function configSignals(path: string, text: string): SkillSignal[] {
  const compose = COMPOSE.test(basename(path));
  const seen = new Set<string>();
  const out: SkillSignal[] = [];
  for (const image of compose ? composeServiceImages(text) : dockerfileImages(text))
    for (const [pattern, skill] of IMAGE_SKILLS) {
      if (!pattern.test(image) || seen.has(skill)) continue;
      seen.add(skill);
      out.push(signal(skill, path, 'config', 'code', `${compose ? 'service image' : 'FROM'} ${image}`));
    }
  return out;
}

/** Skills a README names: declaration-level, since a README neither shows who wrote the code nor how a tool is used. */
export const readmeSignals = (path: string, text: string): SkillSignal[] =>
  [...extractSkills(text)].map((skill) => signal(skill, path, 'readme', 'declaration', 'named in README'));

/** One file the reader fetched, to its reader. */
export function fileSignals(path: string, text: string): SkillSignal[] {
  const role = fileRole(path);
  if (role === 'manifest') return manifestSignals(path, text);
  if (role === 'config') return configSignals(path, text);
  if (role === 'readme') return readmeSignals(path, text);
  return [];
}

// --- Classification -------------------------------------------------------------------------------------------------

/** Every skill a rule above can emit. */
const RULE_SKILLS = new Set(
  [
    ...EXTENSION_SKILLS.values(),
    ...IMAGE_SKILLS.map(([, s]) => s),
    'Docker',
    'GitHub Actions',
    'Node.js',
    ...Object.values(PACKAGE_SKILLS).flatMap((t) => Object.values(t)),
  ].map(canonicalize),
);

/** Whether a file scan could ever find evidence for the skill. */
export function isDetectable(skill: string): boolean {
  const name = canonicalize(skill);
  return RULE_SKILLS.has(name) || extractSkills(name).has(name);
}

/** The repository's grade for one target skill, citing up to six signals, code-level first. */
export function classifySkill(skill: string, signals: readonly SkillSignal[], coverage: Coverage): SkillClassification {
  const name = canonicalize(skill);
  const relevant = signals.filter((s) => s.skill === name);
  const code = relevant.filter((s) => s.weight === 'code');
  const kinds = new Set(relevant.map((s) => s.kind));
  const codeFiles = new Set(code.map((s) => s.path));
  const citations = [...code, ...relevant.filter((s) => s.weight !== 'code')]
    .slice(0, MAX_CITATIONS)
    .map(({ path, kind, weight, detail }) => ({ path, kind, weight, detail }));
  const graded = (grade: SkillGrade, reason: GradeReason) => ({ skill: name, grade, reason, citations });

  if (code.length && kinds.size >= 2) return graded('STRONG', 'code_corroborated');
  if (code.length && codeFiles.size >= 2) return graded('STRONG', 'code_files');
  if (relevant.length) return graded('PARTIAL', code.length ? 'single_code_file' : 'declaration_only');
  if (!isDetectable(name)) return graded('UNABLE_TO_VERIFY', 'not_detectable');
  if (coverage.gap) return graded('UNABLE_TO_VERIFY', coverage.gap);
  // Nothing inspected means nothing was checked, so it cannot stand for "not found".
  if (coverage.filesInspected === 0) return graded('UNABLE_TO_VERIFY', 'unreadable');
  return graded('NO_EVIDENCE', 'not_found');
}

/**
 * The skills a rubric's competencies ask for: vocabulary skills named in each competency's name or evidence expected,
 * each tied to its competency, once per competency.
 */
export function targetSkills(
  competencies: readonly { id: string; name: string; evidenceExpected: string }[],
): { competencyId: string; skill: string }[] {
  return competencies.flatMap(({ id, name, evidenceExpected }) =>
    [...extractSkills(`${name}\n${evidenceExpected}`)].map((skill) => ({ competencyId: id, skill })),
  );
}
