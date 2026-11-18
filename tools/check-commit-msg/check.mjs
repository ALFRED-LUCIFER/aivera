// commit-msg hook: the first line must carry a ticket key (AGENTS.md 7, ADR-007). Merge and revert messages pass.
import { readFileSync } from 'node:fs';

export const hasTicketKey = (message) =>
  /\bAIV-P\d+-(?:\d{3}|E\d{2})\b/.test(message.split('\n')[0]) || /^(Merge|Revert) /.test(message);

if (process.argv[2]) {
  const message = readFileSync(process.argv[2], 'utf8');
  if (!hasTicketKey(message)) {
    console.error('Commit message needs a ticket key on its first line, e.g. "AIV-P0-002: add migration runner".');
    process.exit(1);
  }
}
