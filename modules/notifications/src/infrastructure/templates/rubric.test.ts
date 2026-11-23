import { describe, expect, it } from 'vitest';
import { rubricApprovalData, type Sender } from '../../domain/email.ts';
import { color } from './components.tsx';
import { renderEmail } from './render.ts';

// AIV-P1-014: the rubric approval emails against the ERubric, EApproved and EReturned artboards
// (docs/01-design/artboards). Synthetic cast.

const layla: Sender = {
  name: 'Layla Haddad',
  shortName: 'Layla',
  email: 'layla.haddad@example.com',
  workspace: 'Demo Hiring Co',
};
const head: Sender = {
  name: 'Head of Engineering',
  shortName: 'Head of Engineering',
  email: 'head.of.engineering@example.com',
  workspace: 'Demo Hiring Co',
};
const ctx = (sender: Sender) => ({
  locale: 'en' as const,
  timeZone: 'Asia/Dubai',
  origin: 'https://credalent.example',
  synthetic: false,
  sender,
});
const link = 'https://credalent.example/app/jobs/0190d4a2/rubric?version=0190d4a3&revision=2';
const footer = ['', '--', 'Demo Hiring Co', 'You are receiving this because you are a member of this workspace.'];

describe('rubric-approval template (ERubric)', () => {
  const data = {
    jobTitle: 'Senior AI Engineer',
    version: 2,
    competencies: [
      { name: 'LLM systems in production', weightPercent: 25, levelNeeded: 4 },
      { name: 'Arabic and bilingual NLP', weightPercent: 10, levelNeeded: 2 },
    ],
    changes: { since: 1, note: 'Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.' },
    link,
  };

  it('renders the plain text: who sent it, the competencies, what changed, and the link', async () => {
    const { subject, text } = await renderEmail('rubric-approval', data, ctx(layla));
    expect(subject).toBe('Rubric waiting for your approval: Senior AI Engineer');
    expect(text).toBe(
      [
        'Sent by Layla Haddad at Demo Hiring Co through Credalent',
        '',
        'SENIOR AI ENGINEER: VERSION 2 OF THE RUBRIC IS WAITING FOR YOUR APPROVAL',
        '',
        'Layla Haddad at Demo Hiring Co sent you version 2 of the rubric. *Approve or return version 2* once you have reviewed the competencies below. If you return it, add a note.',
        '',
        'Competency | Weight | Level needed',
        'LLM systems in production | 25% | 4 of 5',
        'Arabic and bilingual NLP | 10% | 2 of 5',
        '',
        'What changed since version 1',
        '- Changed: Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
        '',
        'Note: Nothing is assessed until you approve.',
        '',
        'Review and approve:',
        link,
        ...footer,
        'Replies go to Layla Haddad.',
        'Privacy: https://credalent.example/privacy',
      ].join('\n'),
    );
  });

  it('renders the HTML: preheader, a real table of competencies, one button', async () => {
    const { html } = await renderEmail('rubric-approval', data, ctx(layla));
    expect(html).toContain('Version 2, with what changed. Nothing is assessed until you approve.');
    expect(html).toContain('<th scope="col"');
    expect(html.match(/class="e-button"/g)).toHaveLength(1);
  });

  it('version 1, with nothing approved yet, has no "what changed"', async () => {
    const { text, html } = await renderEmail('rubric-approval', { ...data, version: 1, changes: null }, ctx(layla));
    expect(text).not.toContain('What changed');
    expect(html).toContain('Version 1. Nothing is assessed until you approve.');
  });

  it('refuses data with a weight out of range, so a malformed rubric is never sent', () => {
    const bad = { ...data, competencies: [{ name: 'X', weightPercent: 0, levelNeeded: 3 }] };
    expect(rubricApprovalData.safeParse(bad).success).toBe(false);
  });
});

describe('rubric-approved template (EApproved)', () => {
  it('says who approved which version and when, with the status icon and word', async () => {
    const data = { jobTitle: 'Senior AI Engineer', version: 2, approvedAt: new Date('2026-11-12T08:00:00Z'), link };
    const { subject, text, html } = await renderEmail('rubric-approved', data, ctx(head));
    expect(subject).toBe('Rubric approved: Senior AI Engineer');
    expect(text.split('\n').slice(0, 9)).toEqual([
      'Sent by Head of Engineering at Demo Hiring Co through Credalent',
      '',
      'Approved · Version 2',
      '',
      'THE RUBRIC FOR SENIOR AI ENGINEER IS APPROVED',
      '',
      'Head of Engineering approved version 2 · 12 Nov 2026. Assessment can now start for this job.',
      '',
      'You do not need to do anything.',
    ]);
    // Never colour alone: the approved colour travels with the check icon and the word.
    expect(html).toContain(`color:${color.light.ok}`);
    expect(html).toMatch(/<path d="m5 12.5 4.5 4.5L19 7.5"><\/path><\/svg> <!-- -->Approved/);
  });
});

describe('rubric-returned template (EReturned)', () => {
  it('quotes the note and says the approved version stays in force', async () => {
    const data = {
      jobTitle: 'Senior AI Engineer',
      version: 3,
      note: 'Arabic NLP should be desirable',
      inForce: true,
      link,
    };
    const { subject, text } = await renderEmail('rubric-returned', data, ctx(head));
    expect(subject).toBe('Rubric returned with a note: Senior AI Engineer');
    expect(text.split('\n').slice(2, 15)).toEqual([
      'Returned · Version 3',
      '',
      'HEAD OF ENGINEERING RETURNED VERSION 3 OF THE RUBRIC',
      '',
      'Head of Engineering returned version 3 for Senior AI Engineer with a note. Open the rubric to change it and send it again.',
      '',
      'Note from Head of Engineering',
      '*“Arabic NLP should be desirable”*',
      '',
      'Note: The previously approved version still applies.',
      '',
      'Open the rubric:',
      link,
    ]);
  });

  it('with no approved version, says nothing is assessed until one is', async () => {
    const data = { jobTitle: 'Senior Product Designer', version: 1, note: 'Add a portfolio', inForce: false, link };
    const { text } = await renderEmail('rubric-returned', data, ctx(head));
    expect(text).toContain('Note: Nothing is assessed until a version is approved.');
  });
});
