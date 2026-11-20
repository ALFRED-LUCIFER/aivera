import { describe, expect, it } from 'vitest';
import { evidenceRequestData, type EvidenceRequestData, type Sender } from '../../domain/email.ts';
import { color } from './components.tsx';
import { renderEmail } from './render.ts';

// AIV-P0-017: the evidence-request template against the EEvidence artboard (docs/01-design/artboards). Synthetic cast.

const sender: Sender = {
  name: 'Layla Haddad',
  shortName: 'Layla',
  email: 'layla.haddad@example.com',
  workspace: 'Demo Hiring Co',
};
const data: EvidenceRequestData = {
  jobTitle: 'Senior AI Engineer',
  items: [
    {
      competency: 'Arabic and bilingual NLP',
      claim: 'I built a Gulf Arabic evaluation set.',
      ask: 'Send a link, a sample, or a short note on how you built it.',
    },
    {
      competency: 'Cost and reliability',
      claim: 'I cut cost per request by 40%.',
      ask: 'Send a dashboard export, or a few lines on what you changed and how it was measured.',
    },
  ],
  link: 'https://aivera.example/l/9fK2xQ7mT4vB',
  deleteUrl: 'https://aivera.example/l/delete-9fK2xQ',
};
const ctx = (synthetic: boolean) => ({
  locale: 'en' as const,
  timeZone: 'Asia/Dubai',
  origin: 'https://aivera.example',
  synthetic,
  sender,
});

describe('evidence-request template', () => {
  it('has the artboard subject, with the job and no personal data', async () => {
    const { subject } = await renderEmail('evidence-request', data, ctx(false));
    expect(subject).toBe('A request about your application: Senior AI Engineer');
  });

  it('renders the artboard plain-text version', async () => {
    const { text } = await renderEmail('evidence-request', data, ctx(false));
    await expect(text).toMatchFileSnapshot('__snapshots__/evidence-request.txt');
  });

  it('renders the HTML: preheader, heading, the asks highlighted, one button with its copy link, footer', async () => {
    const { html } = await renderEmail('evidence-request', data, ctx(false));
    expect(html).toMatch(/^<!DOCTYPE html/);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('The recruiter would like to see more of your work. About two minutes.');
    expect(html).toContain('More evidence would help your application');
    expect(html).toContain('Sent by Layla Haddad at Demo Hiring Co through Aivera');
    // The highlighter marks the two asks (highlight.test.ts).
    expect(html.match(/class="e-hl"/g)).toHaveLength(2);
    expect(html).toContain(`background-color:${color.light.highlight}`);
    expect(html.match(/class="e-button"/g)).toHaveLength(1);
    expect(html.match(/href="https:\/\/aivera.example\/l\/9fK2xQ7mT4vB"/g)).toHaveLength(1);
    expect(html).toContain('Button not working? Copy this link:');
    expect(html).toContain('Questions? Reply to this email and it goes to Layla.');
    expect(html).toContain('href="https://aivera.example/l/delete-9fK2xQ"');
    expect(html).toContain('src="https://aivera.example/brand/aivera-mark.png"');
    expect(html).not.toContain('Synthetic data');
  });

  it('ships the dark colours in a prefers-color-scheme block', async () => {
    const { html } = await renderEmail('evidence-request', data, ctx(false));
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html).toContain(`.e-card{background-color:${color.dark.card}!important`);
    expect(html).toContain(`.e-hl{background-color:${color.dark.highlight}!important;color:${color.dark.onHighlight}`);
  });

  it('adds the synthetic-data band in development, in HTML and plain text', async () => {
    const { html, text } = await renderEmail('evidence-request', data, ctx(true));
    expect(html).toContain('Synthetic data — development environment');
    expect(text.split('\n')[0]).toBe('Synthetic data — development environment');
  });

  it('leaves out "You said" for a competency without a claim', async () => {
    const { text } = await renderEmail(
      'evidence-request',
      { ...data, items: [{ competency: 'Cost and reliability', ask: 'Send a dashboard export.' }] },
      ctx(false),
    );
    expect(text).toContain('- Cost and reliability. *Send a dashboard export.*');
    expect(text).not.toContain('You said');
  });
});

describe('evidence-request data schema', () => {
  it('names a missing job title', () => {
    const { jobTitle: _missing, ...withoutTitle } = data;
    const result = evidenceRequestData.safeParse(withoutTitle);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['jobTitle']);
  });

  it('refuses a link that is not https and an empty list', () => {
    expect(evidenceRequestData.safeParse({ ...data, link: 'http://aivera.example/l/x' }).success).toBe(false);
    expect(evidenceRequestData.safeParse({ ...data, items: [] }).success).toBe(false);
  });
});
