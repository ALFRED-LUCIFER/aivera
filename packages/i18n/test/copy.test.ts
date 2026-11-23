import { describe, expect, it } from 'vitest';
import en from '../messages/en.json' with { type: 'json' };

// Product voice rules for every user-facing message (AIV-P2-066, PRODUCT.md, AGENTS.md 1.7).
const flatten = (o: object, prefix = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flatten(v as object, `${prefix}${k}.`),
  );
const messages = flatten(en);
const withoutArgs = (text: string) => text.replace(/\{\w+\}/g, '');
const matching = (test: (text: string) => boolean) => messages.filter(([, text]) => test(text)).map(([key]) => key);

// "Role" is right where it names a workspace member's role, never a job.
const MEMBER_ROLE_KEYS = new Set([
  'emails.memberInvitation.preheader',
  'members.table.role',
  'members.actions.roleFor',
  'members.actions.changeRole',
  'members.invite.role',
]);

// SAFETY: mutation check: put "Free to browse and apply. Always." back in candidate.home.free -> "Always." failed
describe('the message catalogue', () => {
  it.each([
    // Build talk
    'next request',
    'packages/ai/evals',
    'opaque id',
    'in this environment yet',
    'golden cases',
    // Promises without a basis
    'about two minutes',
    'five or six',
    'answered in minutes',
    'interview fewer people',
    'Always.',
    'still honest',
  ])('never says "%s"', (phrase) => {
    expect(matching((text) => text.toLowerCase().includes(phrase.toLowerCase()))).toEqual([]);
  });

  it('says "job", "hiring owner" and "industry pack": never "role" for a job, "hiring manager" or "domain pack"', () => {
    expect(
      matching((text) => /\broles?\b/i.test(withoutArgs(text))).filter((key) => !MEMBER_ROLE_KEYS.has(key)),
    ).toEqual([]);
    expect(matching((text) => /hiring managers?|domain packs?/i.test(text))).toEqual([]);
  });

  it('says a load failure one way: "We could not load <thing>. Try again."', () => {
    expect(
      matching((text) => /could not (be )?load/i.test(text) && !/^We could not load .+\. Try again\.$/.test(text)),
    ).toEqual([]);
  });

  it('ends progress text with an ellipsis', () => {
    expect(
      matching((text) => /^(Loading|Saving|Reading|Checking|Uploading)\b/.test(text) && !text.includes('…')),
    ).toEqual([]);
  });

  it('hard-codes no year', () => {
    expect(matching((text) => /\b20\d\d\b/.test(text))).toEqual([]);
  });

  it('uses no semicolons, as the design canvas does: a full stop or a comma instead', () => {
    expect(matching((text) => text.includes(';'))).toEqual([]);
  });
});
