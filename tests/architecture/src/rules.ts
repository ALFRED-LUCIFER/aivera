import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type Violation = { rule: string; file: string; detail: string };

/** Pairs a module may never import: paying never changes ranking (AGENTS.md 1.8). */
export const FORBIDDEN_MODULE_IMPORTS: Record<string, string[]> = {
  // ops holds platform settings (ADR-012 point 9): nothing that ranks may read them either.
  assessment: ['billing', 'portfolio', 'ops'],
  jobs: ['billing', 'portfolio', 'ops'],
  evidence: ['billing', 'portfolio', 'ops'],
  intake: ['billing', 'portfolio', 'ops'],
};

/** Recruiter-side modules never import candidate-accounts, so none can tell a recruiter is also a candidate (ADR-009). */
export const RECRUITER_SIDE_MODULES = new Set([
  'workspaces',
  'candidates',
  'jobs',
  'intake',
  'evidence',
  'assessment',
  'interviews',
  'decisions',
  'pool',
]);

// shortcut: catches named imports of Db or createDb only, not `import * as` or a direct postgres/drizzle client; widen it
// if a module ever needs another way to reach the database.
const RAW_POOL_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@credalent\/db(?:\/client)?['"]/g;
const CANDIDATE_SITE = /[/\\]src[/\\](?:app[/\\]\(candidate\)|features[/\\]candidate-[^/\\]+)[/\\]/;
// `@/…` or a relative path resolved to src/: the session readers (server/auth, server/workspace) and the recruiter shell.
const RECRUITER_SESSION =
  /^(?:next-auth|@auth\/)|(?:^@|[/\\]src)[/\\](?:server[/\\](?:auth|workspace)\b|features[/\\]shell(?:[/\\]|$))/;
// AIV-P3-007, ADR-009: the candidate account and session reach only the candidate site, its server readers
// (src/server/candidate*), and the roots that wire them (the proxy, instrumentation, the candidate Auth.js route).
const CANDIDATE_DATA = /^@credalent\/candidate-accounts(?:\/|$)|(?:^@|[/\\]src)[/\\]server[/\\]candidate[^/\\.]*/;
const CANDIDATE_DATA_READERS =
  /[/\\]src[/\\](?:app[/\\]\(candidate\)[/\\]|features[/\\]candidate-[^/\\]+[/\\]|server[/\\]candidate[^/\\]*$|app[/\\]api[/\\]candidate-auth[/\\]|proxy\.ts$|instrumentation\.ts$)/;
// AIV-P3-002: the public API reaches the jobs contract and the public reads, nothing else of the app or the modules.
const PUBLIC_API = /[/\\]src[/\\]app[/\\]api[/\\]public[/\\]/;
const PUBLIC_API_ALLOWED = new Set(['@credalent/jobs', '@/server/publicJobs', '@/server/publicEntry']);
// AIV-P2-035 (ADR-012): the operator console's pages, layouts and route handlers, and its server action files.
const OPS_AREA = /[/\\]src[/\\](?:app[/\\]\(ops\)|features[/\\]ops(?:-[^/\\]+)?)[/\\]/;
// template and default render children like a layout; loading, error and not-found render no console data.
const ROUTE_FILE = /[/\\](?:page|layout|template|default|route)\.tsx?$/;
const USE_SERVER = /^\s*['"]use server['"]/;
const PLATFORM_OPERATOR_POLICY = /\bawait platformOperator\(\)/;
// shortcut: sees `export [default] [async] function` only, not `export const x = async () =>`; widen it if the console
// ever exports an entry point that way.
const EXPORTED_FUNCTION = /\bexport\s+(?:default\s+)?(?:async\s+)?function\b/;
/** Every exported function of the file (each page, metadata, action or handler) awaits the policy; at least one. */
const everyExportChecked = (text: string) => {
  const exported = text.split(EXPORTED_FUNCTION).slice(1);
  return exported.length > 0 && exported.every((body) => PLATFORM_OPERATOR_POLICY.test(body));
};
// AIV-P2-036 (ADR-012 point 6): console code (the /ops area, features/ops*, server/ops*, modules/ops) reads platform
// metadata only through these modules' contracts, and never holds the pool; server/operator.ts wires the reads.
const OPS_READ_AREA = /[/\\]src[/\\](?:app[/\\]\(ops\)[/\\]|features[/\\]ops(?:-[^/\\]+)?[/\\]|server[/\\]ops[^/\\]*$)/;
const OPS_CONTRACTS = new Set(['workspaces', 'jobs', 'audit']);
const RAW_DATABASE = /^(?:@credalent\/db(?:\/.*)?|drizzle-orm(?:\/.*)?|postgres|pg)$/;
// `@/server/…` or a relative path resolved to src/server/: of the app's server code (the pool, the full workspaces and
// jobs contracts), console code imports only operator.ts, which holds the policy and the metadata reads.
const APP_SERVER = /(?:^@|[/\\]src)[/\\]server[/\\]([^/\\]+?)(?:\.tsx?)?$/;
const SOURCE = /\.(?:ts|tsx|mts|js|mjs)$/;
// AIV-P2-037, AIV-P2-039 (ADR-012 points 7 and 9), AIV-P2-045 (ADR-013 point 15): the contract methods that change a
// workspace, a platform setting or the catalogue draft for an operator take no member context and check no role, so only
// server/operator.ts, behind platformOperator(), may call them.
const OPERATOR_ONLY_CALL =
  /\.(?:changeStatus|pausePublicListings|setApprovalRequired|openDraft|saveDraftPack|saveDraftCompetency|retireDraftEntry)\(/;
const OPERATOR_SERVER = /[/\\]src[/\\]server[/\\]operator\.ts$/;
// AIV-P2-053 (ADR-012 point 8): the platform audit log is read only by console code (and server/operator.ts, which
// wires the console's reads).
const PLATFORM_AUDIT_READ = /\.listPlatformEntries\(/;
// AIV-P1-056: setJobOwner trusts the job id and the previous owner it is given, so only the jobs module, which passes
// the job it is saving, calls it.
const JOB_OWNER_CALL = /\.setJobOwner\(/;
// AIV-P2-044 (ADR-013 point 15): the catalogue is read from the database; its old code constants must not come back.
const CODE_CATALOGUE =
  /\b(?:JOB_TYPES|JOB_TYPE_CATALOGUE|JOB_TYPE_CATALOGUE_VERSION|DOMAIN_KEYS|DOMAIN_PACK_CATALOGUE_VERSION|listDomainPacks|getDomainPack)\b/;
const SKIP = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo', 'fixtures']);
const IMPORT =
  /(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

export function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.next')) continue; // .next and NEXT_DIST_DIR builds such as .next-e2e-*
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const dirsIn = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()) : [];

/** The unit a path belongs to, e.g. "modules/jobs", "packages/ui", "apps/web". */
function unitOf(root: string, path: string): string | undefined {
  const [top, name] = relative(root, path).split(sep);
  return top && name && ['apps', 'modules', 'packages'].includes(top) ? `${top}/${name}` : undefined;
}

export function findViolations(root: string): Violation[] {
  const modules = new Set(dirsIn(join(root, 'modules')));
  const appPackages = new Set(
    dirsIn(join(root, 'apps')).flatMap((app) => {
      const pkg = join(root, 'apps', app, 'package.json');
      return existsSync(pkg) ? [(JSON.parse(readFileSync(pkg, 'utf8')) as { name: string }).name] : [];
    }),
  );
  const violations: Violation[] = [];

  for (const top of ['apps', 'modules', 'packages']) {
    for (const file of walk(join(root, top))) {
      const rel = relative(root, file);
      const unit = unitOf(root, file);
      if (!unit) continue;
      const [kind, name] = unit.split('/') as [string, string];

      if (
        kind === 'apps' &&
        /[/\\]src[/\\]features[/\\][^/\\]+[/\\]components[/\\]/.test(file) &&
        !file.endsWith('.tsx')
      ) {
        violations.push({
          rule: 'components-tsx-only',
          file: rel,
          detail: 'components/ holds .tsx only; move logic to domain/ (ADR-003)',
        });
      }
      if (!SOURCE.test(file)) continue;

      if (kind === 'apps' && OPS_AREA.test(file) && !/\.test\.tsx?$/.test(file)) {
        const text = readFileSync(file, 'utf8');
        if ((ROUTE_FILE.test(file) || USE_SERVER.test(text)) && !everyExportChecked(text))
          violations.push({
            rule: 'ops-platform-operator-policy',
            file: rel,
            detail:
              'every exported /ops page, layout, metadata, route handler and server action awaits platformOperator() (ADR-012)',
          });
      }

      if (
        kind === 'apps' &&
        !OPERATOR_SERVER.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        OPERATOR_ONLY_CALL.test(readFileSync(file, 'utf8'))
      )
        violations.push({
          rule: 'operator-only-writes',
          file: rel,
          detail:
            'changeStatus, pausePublicListings, setApprovalRequired and the catalogue draft writes are called only from server/operator.ts (ADR-012, ADR-013)',
        });

      if (
        !(kind === 'apps' && (OPS_READ_AREA.test(file) || OPERATOR_SERVER.test(file))) &&
        unit !== 'modules/ops' &&
        !/\.test\.tsx?$/.test(file) &&
        PLATFORM_AUDIT_READ.test(readFileSync(file, 'utf8'))
      )
        violations.push({
          rule: 'platform-audit-read-console-only',
          file: rel,
          detail:
            'listPlatformEntries is called only from app/(ops), features/ops*, server/ops*, server/operator.ts or modules/ops (ADR-012)',
        });

      if (
        unit !== 'modules/jobs' &&
        unit !== 'modules/workspaces' &&
        !/\.test\.tsx?$/.test(file) &&
        JOB_OWNER_CALL.test(readFileSync(file, 'utf8'))
      )
        violations.push({
          rule: 'job-owner-from-jobs',
          file: rel,
          detail: 'setJobOwner is called only by the jobs module, for the job it is saving (AIV-P1-056)',
        });

      if (CODE_CATALOGUE.test(readFileSync(file, 'utf8')))
        violations.push({
          rule: 'no-code-catalogue',
          file: rel,
          detail: 'job types and domain packs come from the published catalogue in the database (ADR-013 point 15)',
        });

      // AIV-P0-010: module code takes the workspace-scoped `tx` from the request context; only composition holds the pool.
      if (kind === 'modules' && !/[/\\]src[/\\]composition\.ts$/.test(file)) {
        for (const [, names = ''] of readFileSync(file, 'utf8').matchAll(RAW_POOL_IMPORT)) {
          if (names.split(',').some((n) => /^\s*(?:type\s+)?(?:Db|createDb)\b/.test(n)))
            violations.push({
              rule: 'scoped-tx-only',
              file: rel,
              detail: 'module code takes the scoped tx, never the raw pool (Db); only composition.ts holds it',
            });
        }
      }

      const opsCode =
        ((kind === 'apps' && OPS_READ_AREA.test(file)) || unit === 'modules/ops') && !/\.test\.tsx?$/.test(file);

      for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const spec = match[1] ?? match[2] ?? match[3] ?? '';
        const add = (rule: string, detail: string) =>
          violations.push({ rule, file: rel, detail: `${spec}: ${detail}` });

        const scoped = /^@credalent\/([^/]+)(?:\/(.+))?$/.exec(spec);
        if (scoped) {
          const [, target = '', subpath] = scoped;
          if (modules.has(target) && target !== name) {
            if (subpath === 'composition' && kind !== 'apps')
              add('composition-apps-only', "only apps import a module's composition (ADR-002)");
            else if (subpath && subpath !== 'composition')
              add('module-contracts-only', 'import a module only as @credalent/<m> (ADR-002)');
            if (kind === 'modules' && FORBIDDEN_MODULE_IMPORTS[name]?.includes(target))
              add('paying-never-changes-ranking', `${name} may not import ${target} (AGENTS.md 1.8)`);
            if (kind === 'modules' && target === 'candidate-accounts' && RECRUITER_SIDE_MODULES.has(name))
              add('recruiter-side-no-candidate-accounts', `${name} may not import candidate-accounts (ADR-009)`);
          }
          if (kind === 'modules' && (target === 'ui' || target === 'tokens'))
            add('module-no-ui', 'modules hold no UI (AGENTS.md 9.4)');
        }
        if (opsCode) {
          const resolved = spec.startsWith('.') ? resolve(dirname(file), spec) : spec;
          const target = scoped?.[1] ?? '';
          if (
            (modules.has(target) && target !== 'ops' && (!OPS_CONTRACTS.has(target) || scoped?.[2])) ||
            (kind === 'apps' &&
              (RAW_DATABASE.test(resolved) || (APP_SERVER.exec(resolved)?.[1] ?? 'operator') !== 'operator'))
          )
            add(
              'ops-metadata-contracts-only',
              'console code imports only the workspaces, jobs and audit contracts and server/operator, never the pool (ADR-012)',
            );
        }
        // ADR-009: the candidate site reads only its own session, never the recruiter one or the recruiter shell.
        if (
          kind === 'apps' &&
          CANDIDATE_SITE.test(file) &&
          RECRUITER_SESSION.test(spec.startsWith('.') ? resolve(dirname(file), spec) : spec)
        )
          add('candidate-site-no-recruiter-session', 'the candidate site never reads the recruiter session (ADR-009)');
        if (
          kind === 'apps' &&
          /[/\\]src[/\\]/.test(file) &&
          !CANDIDATE_DATA_READERS.test(file) &&
          CANDIDATE_DATA.test(spec.startsWith('.') ? resolve(dirname(file), spec) : spec)
        )
          add(
            'recruiter-app-no-candidate-data',
            'only the candidate site reads candidate accounts and sessions (ADR-009)',
          );
        if (
          kind === 'apps' &&
          PUBLIC_API.test(file) &&
          !/\.test\.tsx?$/.test(file) &&
          (spec.startsWith('.') || /^@(?:credalent\/|\/)/.test(spec)) &&
          !PUBLIC_API_ALLOWED.has(spec)
        )
          add(
            'public-api-jobs-only',
            'the public API imports only @credalent/jobs and @/server/publicJobs (AIV-P3-002)',
          );
        if (unit !== 'packages/ai' && (spec === 'ai' || spec.startsWith('ai/') || spec.startsWith('@ai-sdk/')))
          add('ai-sdk-only-in-packages-ai', 'call a model through @credalent/ai only (ADR-006)');
        if (kind === 'packages' && appPackages.has(spec.split('/')[0] ?? ''))
          add('package-imports-app', 'no package imports an app (AGENTS.md 9.4)');

        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          const targetUnit = unitOf(root, target);
          if (targetUnit !== unit) {
            add(
              kind === 'packages' && targetUnit?.startsWith('apps/') ? 'package-imports-app' : 'relative-crosses-unit',
              `relative import leaves ${unit} (ADR-002)`,
            );
          }
        }
      }
    }
  }
  return violations;
}
