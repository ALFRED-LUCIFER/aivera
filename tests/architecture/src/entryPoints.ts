import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { walk, type Violation } from './rules.ts';

// AGENTS.md 1.3 (AIV-P0-907): every server action, route handler and worker consumer declares its policy or is
// explicitly public. Declared means one of:
// - the export is the call result of a wrapper: `workspaceAction(...)`, `publicEntry('<reason>', handler)` or, for an
//   action that needs only the signed-in session because there is no workspace yet, `sessionEntry('<reason>', handler)`;
// - the exported function calls a policy guard itself, directly or through a function of the same file: the workspace
//   context (`inActiveWorkspace`), the operator policy (`platformOperator`), or a same-file binding that holds
//   workspaceAction (`const add = workspaceAction(...)`; publicEntry and sessionEntry are labels, not guards).
// A worker consumer is the `.handle` of a `createConsumer(...)` (each handler runs in its envelope's workspace
// transaction) or `systemConsumer('<reason>', handler)`.
// shortcut: by name, without the type checker, and a guard call anywhere in the body counts (not proven to run on every
// path); code review checks the guard is the right one, as the ticket says.
const WRAPPERS = new Set(['workspaceAction']);
const REASONED = { web: new Set(['publicEntry', 'sessionEntry']), worker: new Set(['systemConsumer']) };
const GUARDS = new Set(['inActiveWorkspace', 'platformOperator']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
// Every extension Next.js serves a route from (the default pageExtensions, plus dev.tsx in dev, next.config.ts).
const ROUTE = /[/\\]src[/\\]app[/\\](?:.+[/\\])?route\.(?:dev\.)?[cm]?[jt]sx?$/;
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
// The worker's one Service Bus adapter: anything else receiving messages is a consumer this check cannot see.
const SERVICE_BUS = /[/\\]serviceBus\.ts$/;
const RAW_RECEIVE = new Set([
  'subscribe',
  'receiveMessages',
  'receiveDeferredMessages',
  'getMessageIterator',
  'processMessage',
]);
const SESSION_READERS = new Set(['getSessionUserId', 'getCandidateSessionUserId']);

type Fn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
const isFn = (node: ts.Node | undefined): node is Fn =>
  !!node && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const callee = (node: ts.Node) =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : undefined;
const exported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const violation = (file: string, name: string, detail: string): Violation => ({
  rule: 'entry-point-policy',
  file,
  detail: `${name}: ${detail}`,
});

/** Whether the statements open with the `'use server'` directive (the prologue, after any comments). */
function useServer(statements: readonly ts.Statement[]): boolean {
  for (const s of statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) return false;
    if (s.expression.text === 'use server') return true;
  }
  return false;
}

/** Whether `node` contains a call to one of `names`. */
function calls(node: ts.Node, names: Set<string>): boolean {
  const name = callee(node);
  return (
    (name !== undefined && names.has(name)) || !!ts.forEachChild(node, (child) => calls(child, names) || undefined)
  );
}

/**
 * The policy guards, this file's top-level bindings that hold `workspaceAction(...)` (the only wrapper that authorises),
 * and its top-level functions that call either, until no more are found.
 */
function guardsOf(file: ts.SourceFile): Set<string> {
  const local = new Map<string, Fn>();
  const guards = new Set(GUARDS);
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) local.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        if (isFn(d.initializer)) local.set(d.name.text, d.initializer);
        else if (d.initializer && WRAPPERS.has(callee(d.initializer) ?? '')) guards.add(d.name.text);
      }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, fn] of local) if (!guards.has(name) && calls(fn, guards)) grew = !!guards.add(name);
  }
  return guards;
}

/** Why `value` is not a declared entry point, or null when it is. */
function problem(value: ts.Node | undefined, guards: Set<string>, reasoned: Set<string>): string | null {
  if (value && ts.isCallExpression(value)) {
    const name = callee(value) ?? '';
    if (WRAPPERS.has(name)) return null;
    if (reasoned.has(name)) {
      const [reason, handler] = value.arguments;
      if (!reason || !ts.isStringLiteralLike(reason) || !reason.text.trim()) return `${name} needs a reason`;
      // sessionEntry is a session policy only when its handler reads the session.
      if (name === 'sessionEntry' && !(handler && calls(handler, SESSION_READERS)))
        return 'sessionEntry never reads the session';
      return null;
    }
  }
  if (isFn(value) && calls(value, guards)) return null;
  return 'declares no policy: wrap it in workspaceAction or publicEntry, or call the policy guard (AGENTS.md 1.3)';
}

function webViolations(rel: string, file: ts.SourceFile, route: boolean): Violation[] {
  const found: Violation[] = [];
  if (!route && !useServer(file.statements)) {
    // An inline `'use server'` closure in a component is an entry point no export shows: refused, so actions live in a
    // services file this check reads.
    const visit = (node: ts.Node) => {
      if (
        (isFn(node) || ts.isMethodDeclaration(node)) &&
        node.body &&
        ts.isBlock(node.body) &&
        useServer(node.body.statements)
      )
        found.push(
          violation(
            rel,
            node.name?.getText(file) ?? 'inline action',
            "inline 'use server': move it to a 'use server' file",
          ),
        );
      ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
  }
  const guards = guardsOf(file);
  const check = (name: string, value: ts.Node | undefined) => {
    if (route && !HTTP_METHODS.has(name)) return;
    const detail = problem(value, guards, REASONED.web);
    if (detail) found.push(violation(rel, name, detail));
  };
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && exported(statement)) check(statement.name?.text ?? 'default', statement);
    else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const d of statement.declarationList.declarations)
        if (ts.isIdentifier(d.name)) check(d.name.text, d.initializer);
        // `export const { GET, POST } = handlers` hides each handler's declaration: refused.
        else found.push(violation(rel, d.name.getText(file), 'destructured export; declare each entry point by name'));
    } else if (ts.isExportAssignment(statement)) check('default', statement.expression);
    // A re-export hides the declaration from this check: refused, so every entry point is declared where it is defined.
    else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const names =
        statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements : [];
      for (const name of names.length ? names.map((n) => n.name.text) : ['*'])
        if (!route || name === '*' || HTTP_METHODS.has(name))
          found.push(violation(rel, name, 're-exported; declare it where it is defined'));
    }
  }
  return found;
}

function workerViolations(rel: string, file: ts.SourceFile): Violation[] {
  const consumers = new Set<string>();
  const subscribed: ts.Expression[] = [];
  const found: Violation[] = [];
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
    // Straight on the SDK (`receiver.subscribe`, `receiveMessages`, a `processMessage` handler): refused outside the adapter.
    const name =
      ts.isPropertyAccessExpression(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodDeclaration(node)
        ? node.name
        : undefined;
    if (!SERVICE_BUS.test(rel) && name && ts.isIdentifier(name) && RAW_RECEIVE.has(name.text))
      found.push(
        violation(rel, name.text, 'receives from Service Bus outside serviceBus.ts; use subscribe (AGENTS.md 1.3)'),
      );
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const handler of subscribed) {
    const fromConsumer =
      ts.isPropertyAccessExpression(handler) &&
      handler.name.text === 'handle' &&
      ts.isIdentifier(handler.expression) &&
      consumers.has(handler.expression.text);
    const reasoned = callee(handler) === 'systemConsumer' ? problem(handler, new Set(), REASONED.worker) : undefined;
    if (fromConsumer || reasoned === null) continue;
    const detail = reasoned ?? 'consumed outside createConsumer and systemConsumer (AGENTS.md 1.3)';
    found.push(violation(rel, handler.getText(file).split('\n')[0] ?? '', detail));
  }
  return found;
}

/** Every server action, route handler and worker consumer under `root` that declares no policy. */
export function findUndeclaredEntryPoints(root: string): Violation[] {
  const found: Violation[] = [];
  for (const [app, check] of [
    ['web', webViolations],
    ['backend/worker', workerViolations],
  ] as const) {
    for (const path of walk(join(root, 'apps', app, 'src'))) {
      if (!SOURCE.test(path) || TEST.test(path)) continue;
      const text = readFileSync(path, 'utf8');
      const route = ROUTE.test(path);
      if (app === 'web' && !route && !text.includes('use server')) continue;
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      found.push(...check(relative(root, path), file, route));
    }
  }
  return found;
}
