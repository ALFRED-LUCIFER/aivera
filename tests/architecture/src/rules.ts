import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type Violation = { rule: string; file: string; detail: string };

/** Pairs a module may never import: paying never changes ranking (AGENTS.md 1.8). */
export const FORBIDDEN_MODULE_IMPORTS: Record<string, string[]> = {
  assessment: ['billing', 'portfolio'],
  jobs: ['billing', 'portfolio'],
  intake: ['billing', 'portfolio'],
};

const SOURCE = /\.(?:ts|tsx|mts|js|mjs)$/;
const SKIP = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo', 'fixtures']);
const IMPORT =
  /(?:import|export)\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
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

      for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const spec = match[1] ?? match[2] ?? match[3] ?? '';
        const add = (rule: string, detail: string) =>
          violations.push({ rule, file: rel, detail: `${spec}: ${detail}` });

        const scoped = /^@aivera\/([^/]+)(?:\/(.+))?$/.exec(spec);
        if (scoped) {
          const [, target = '', subpath] = scoped;
          if (modules.has(target) && target !== name) {
            if (subpath === 'composition' && kind !== 'apps')
              add('composition-apps-only', "only apps import a module's composition (ADR-002)");
            else if (subpath && subpath !== 'composition')
              add('module-contracts-only', 'import a module only as @aivera/<m> (ADR-002)');
            if (kind === 'modules' && FORBIDDEN_MODULE_IMPORTS[name]?.includes(target))
              add('paying-never-changes-ranking', `${name} may not import ${target} (AGENTS.md 1.8)`);
          }
          if (kind === 'modules' && (target === 'ui' || target === 'tokens'))
            add('module-no-ui', 'modules hold no UI (AGENTS.md 9.4)');
        }
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
