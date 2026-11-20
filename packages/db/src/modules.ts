import { join } from 'node:path';

export type MigratableModule = {
  /** The module's PostgreSQL schema; its folder under modules/ is the same name with `-` for `_`. */
  name: string;
  /** Absolute path of the module root (holds drizzle.config.ts). */
  dir: string;
};

export const migrationsFolder = (module: MigratableModule) => join(module.dir, 'src', 'infrastructure', 'migrations');

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const moduleAt = (name: string): MigratableModule => ({
  name,
  dir: join(repoRoot, 'modules', name.replaceAll('_', '-')),
});

/**
 * Every module with migrations, in the order `pnpm db:migrate` applies them (ADR-004): platform modules first
 * (audit, workspaces, identity), then the rest. A module ticket adds its line here in the PR that creates the module.
 */
export const MODULES: MigratableModule[] = [
  'audit',
  'workspaces',
  'identity',
  'candidates',
  'jobs',
  'evidence',
  'assessment',
  'candidate_accounts',
  'ops',
  'notifications',
].map(moduleAt);
