import { describe, expect, it } from 'vitest';
import type { Sender } from '../../domain/email.ts';
import { renderEmail } from './render.ts';

// AIV-P1-069: in an email the highlighter marks what the recipient must do or provide, chosen by role, always with an
// ink underline and a plain-text mark (DESIGN.md). Synthetic cast.

const sender = (name: string): Sender => ({
  name,
  shortName: name,
  email: 'sender@example.com',
  workspace: 'Demo Hiring Co',
});
const ctx = (name: string) => ({
  locale: 'en' as const,
  timeZone: 'Asia/Dubai',
  origin: 'https://credalent.example',
  synthetic: false,
  sender: sender(name),
});
const link = 'https://credalent.example/l/9fK2xQ7mT4vB';

/** Every highlighted run, with whether it also carries its ink underline. */
const highlights = (html: string) =>
  [...html.matchAll(/<span class="e-hl" style="([^"]*)">(.*?)<\/span>/g)].map(([, style, run]) => ({
    run,
    underlined: style?.includes('text-decoration:underline'),
  }));

describe('emails highlight what the recipient must do', () => {
  it("the candidate's evidence request highlights each requested item, never the candidate's own quoted claim", async () => {
    const items = [
      {
        competency: 'Arabic and bilingual NLP',
        claim: 'I built a Gulf Arabic evaluation set.',
        ask: 'Send a link, a sample, or a short note on how you built it.',
      },
      { competency: 'Cost and reliability', ask: 'Send a dashboard export.' },
    ];
    const data = { jobTitle: 'Senior AI Engineer', items, link, deleteUrl: `${link}/delete` };
    const { html, text } = await renderEmail('evidence-request', data, ctx('Layla Haddad'));
    // SAFETY: mutation check: wrapped the quoted claim in <Required> in EvidenceRequest.tsx -> this test failed
    expect(highlights(html)).toEqual(items.map((item) => ({ run: item.ask, underlined: true })));
    expect(text).toContain('You said: “I built a Gulf Arabic evaluation set.” *Send a link,');
    expect(text).toContain('- Cost and reliability. *Send a dashboard export.*');
  });

  it("the hiring owner's approval request highlights the decision, and no competency weight", async () => {
    const data = {
      jobTitle: 'Senior AI Engineer',
      version: 2,
      competencies: [{ name: 'LLM systems in production', weightPercent: 25, levelNeeded: 4 }],
      changes: null,
      link,
    };
    const { html, text } = await renderEmail('rubric-approval', data, ctx('Layla Haddad'));
    expect(highlights(html)).toEqual([{ run: 'Approve or return version 2', underlined: true }]);
    expect(text).toContain('*Approve or return version 2*');
  });

  it("the recruiter's returned email highlights the note as the change to make", async () => {
    const data = {
      jobTitle: 'Senior AI Engineer',
      version: 3,
      note: 'Arabic NLP should be desirable',
      inForce: true,
      link,
    };
    const { html, text } = await renderEmail('rubric-returned', data, ctx('Head of Engineering'));
    expect(highlights(html)).toEqual([{ run: '“Arabic NLP should be desirable”', underlined: true }]);
    expect(text).toContain('*“Arabic NLP should be desirable”*');
  });

  it('the invitation highlights accepting before it expires', async () => {
    const data = { role: 'recruiter' as const, scope: null, expiresAt: new Date('2026-11-27T08:00:00Z'), link };
    const { html, text } = await renderEmail('member-invitation', data, ctx('Layla Haddad'));
    expect(highlights(html)).toEqual([
      { run: 'Accept the invitation before it expires on 27 Nov 2026.', underlined: true },
    ]);
    expect(text).toContain('Note: *Accept the invitation before it expires on 27 Nov 2026.*');
  });

  it('the rubric approved email, with nothing required, has no highlight', async () => {
    const data = { jobTitle: 'Senior AI Engineer', version: 2, approvedAt: new Date('2026-11-12T08:00:00Z'), link };
    const { html, text } = await renderEmail('rubric-approved', data, ctx('Head of Engineering'));
    expect(highlights(html)).toEqual([]);
    expect(html).not.toContain('class="e-hl"');
    expect(text).not.toContain('*');
  });
});
