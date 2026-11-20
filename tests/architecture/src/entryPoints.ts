import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { walk, type Violation } from './rules.ts';

// AGENTS.md 1.3 (AIV-P0-907): every server action, route handler and worker consumer declares its policy or is
// explicitly public. Declared means one of:
// - the export is the call result of a wrapper: `workspaceAction(...)` or `publicEntry('<reason>', handler)`;
// - the exported function calls a policy guard itself, directly or through a function of the same file: the workspace
//   context (`inActiveWorkspace`), the operator policy (`platformOperator`), or the recruiter or candidate session.
// A worker consumer is the `.handle` of a `createConsumer(...)` (each handler runs in its envelope's workspace
// transaction) or `systemConsumer('<reason>', handler)`.
// shortcut: by name, without the type checker, and a guard call anywhere in the body counts (not proven to run on every
// path); code review checks the guard is the right one, as the ticket says.
const WRAPPERS = new Set(['workspaceAction']);
const REASONED = new Set(['publicEntry', 'systemConsumer']);
const GUARDS = new Set(['inActiveWorkspace', 'platformOperator', 'getSessionUserId', 'getCandidateSessionUserId']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ROUTE = /[/\\]src[/\\]app[/\\](?:.+[/\\])?route\.tsx?$/;
const USE_SERVER = /^\s*['"]use server['"]/;
const SOURCE = /\.tsx?$/;
const TEST = /\.test\.tsx?$/;

type Fn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
const isFn = (node: ts.Node | undefined): node is Fn =>
  !!node && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const callee = (node: ts.Node) =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : undefined;
const exported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Whether `node` contains a call to one of `names`. */
function calls(node: ts.Node, names: Set<string>): boolean {
  const name = callee(node);
  return (
    (name !== undefined && names.has(name)) || !!ts.forEachChild(node, (child) => calls(child, names) || undefined)
  );
}

/** The policy guards plus this file's top-level functions that call one, until no more are found. */
function guardsOf(file: ts.SourceFile): Set<string> {
  const local = new Map<string, Fn>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) local.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations)
        if (ts.isIdentifier(d.name) && isFn(d.initializer)) local.set(d.name.text, d.initializer);
  }
  const guards = new Set(GUARDS);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, fn] of local) if (!guards.has(name) && calls(fn, guards)) grew = !!guards.add(name);
  }
  return guards;
}

/** Why `value` is not a declared entry point, or null when it is. */
function problem(value: ts.Node | undefined, guards: Set<string>): string | null {
  if (value && ts.isCallExpression(value)) {
    const name = callee(value) ?? '';
    if (WRAPPERS.has(name)) return null;
    if (REASONED.has(name)) {
      const [reason] = value.arguments;
      return reason && ts.isStringLiteralLike(reason) && reason.text.trim() ? null : `${name} needs a reason`;
    }
  }
  if (isFn(value) && calls(value, guards)) return null;
  return 'declares no policy: wrap it in workspaceAction or publicEntry, or call the policy guard (AGENTS.md 1.3)';
}

function webViolations(rel: string, file: ts.SourceFile, route: boolean): Violation[] {
  const guards = guardsOf(file);
  const found: Violation[] = [];
  const check = (name: string, value: ts.Node | undefined) => {
    if (route && !HTTP_METHODS.has(name)) return;
    const detail = problem(value, guards);
    if (detail) found.push({ rule: 'entry-point-policy', file: rel, detail: `${name}: ${detail}` });
  };
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && exported(statement)) check(statement.name?.text ?? 'default', statement);
    else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const d of statement.declarationList.declarations) check(d.name.getText(file), d.initializer);
    } else if (ts.isExportAssignment(statement)) check('default', statement.expression);
    // A re-export hides the declaration from this check: refused, so every entry point is declared where it is defined.
    else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const names =
        statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements : [];
      for (const name of names.length ? names.map((n) => n.name.text) : ['*'])
        if (!route || HTTP_METHODS.has(name))
          found.push({
            rule: 'entry-point-policy',
            file: rel,
            detail: `${name}: re-exported; declare it where it is defined`,
          });
    }
  }
  return found;
}

function workerViolations(rel: string, file: ts.SourceFile): Violation[] {
  const consumers = new Set<string>();
  const subscribed: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      callee(node.initializer) === 'createConsumer'
    )
      consumers.add(node.name.text);
    if (ts.isCallExpression(node) && callee(node) === 'subscribe' && node.arguments[1])
      subscribed.push(node.arguments[1]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return subscribed.flatMap((handler) => {
    const fromConsumer =
      ts.isPropertyAccessExpression(handler) &&
      handler.name.text === 'handle' &&
      ts.isIdentifier(handler.expression) &&
      consumers.has(handler.expression.text);
    const reasoned = callee(handler) === 'systemConsumer' ? problem(handler, new Set()) : undefined;
    if (fromConsumer || reasoned === null) return [];
    const detail = reasoned ?? 'consumed outside createConsumer and systemConsumer (AGENTS.md 1.3)';
    return [{ rule: 'entry-point-policy', file: rel, detail: `${handler.getText(file).split('\n')[0]}: ${detail}` }];
  });
}

/** Every server action, route handler and worker consumer under `root` that declares no policy. */
export function findUndeclaredEntryPoints(root: string): Violation[] {
  const found: Violation[] = [];
  for (const [app, check] of [
    ['web', webViolations],
    ['worker', workerViolations],
  ] as const) {
    for (const path of walk(join(root, 'apps', app, 'src'))) {
      if (!SOURCE.test(path) || TEST.test(path)) continue;
      const text = readFileSync(path, 'utf8');
      const route = ROUTE.test(path);
      if (app === 'web' && !route && !USE_SERVER.test(text)) continue;
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      found.push(...check(relative(root, path), file, route));
    }
  }
  return found;
}
