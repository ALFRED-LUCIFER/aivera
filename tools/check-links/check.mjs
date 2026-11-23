// Fails when a relative Markdown link points at a file that does not exist (AGENTS.md 9.6). Run: node tools/check-links/check.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const skip = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'coverage', '.venv']);

function* markdownFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* markdownFiles(path);
    else if (name.endsWith('.md')) yield path;
  }
}

// Inline links [text](target); code spans and fenced blocks are removed first so examples are not checked.
export function relativeTargets(markdown) {
  const text = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const targets = [];
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue; // external, anchor-only or site-absolute
    targets.push(decodeURI(target.split('#')[0]));
  }
  return targets.filter(Boolean);
}

const broken = [];
for (const file of markdownFiles(root)) {
  for (const target of relativeTargets(readFileSync(file, 'utf8'))) {
    if (!existsSync(resolve(dirname(file), target))) broken.push(`${relative(root, file)} -> ${target}`);
  }
}

if (broken.length) {
  console.error(`Broken relative links (${broken.length}):\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
console.log('All relative Markdown links resolve.');
