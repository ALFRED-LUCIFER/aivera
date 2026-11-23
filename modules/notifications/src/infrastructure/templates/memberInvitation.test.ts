import { describe, expect, it } from 'vitest';
import { memberInvitationData, type MemberInvitationData, type Sender } from '../../domain/email.ts';
import { renderEmail } from './render.ts';

// AIV-P1-003: the invitation template against the EInvite and ERoles artboards (docs/01-design/artboards). Synthetic cast.

const sender: Sender = {
  name: 'Layla Haddad',
  shortName: 'Layla',
  email: 'layla.haddad@example.com',
  workspace: 'Demo Hiring Co',
};
const data: MemberInvitationData = {
  role: 'hiring_owner',
  scope: 'Senior AI Engineer',
  // 27 Nov 2026 in Dubai.
  expiresAt: new Date('2026-11-27T08:00:00Z'),
  link: 'https://credalent.example/l/9fK2xQ7mT4vB',
};
const ctx = {
  locale: 'en' as const,
  timeZone: 'Asia/Dubai',
  origin: 'https://credalent.example',
  synthetic: false,
  sender,
};

describe('member-invitation template', () => {
  it('renders the EInvite plain-text version, with no delete-data link (a member, not a candidate)', async () => {
    const { subject, text } = await renderEmail('member-invitation', data, ctx);
    expect(subject).toBe('You are invited to Demo Hiring Co on Credalent');
    expect(text).toBe(
      [
        'Sent by Layla Haddad at Demo Hiring Co through Credalent',
        '',
        'LAYLA HADDAD INVITED YOU TO DEMO HIRING CO',
        '',
        'Layla Haddad invited you to Demo Hiring Co as Hiring owner for Senior AI Engineer. Accept the invitation to get started.',
        '',
        'You can: approve the rubric for Senior AI Engineer, review its shortlist, and record the hiring decision.',
        '',
        'You cannot: see other jobs or their candidates. Hiring owners see only the jobs they are given.',
        '',
        'Note: *Accept the invitation before it expires on 27 Nov 2026.*',
        '',
        'Accept invitation:',
        'https://credalent.example/l/9fK2xQ7mT4vB',
        '',
        '--',
        'Demo Hiring Co',
        'You are receiving this because a member of this workspace invited you.',
        'Replies go to Layla Haddad.',
        'Privacy: https://credalent.example/privacy',
      ].join('\n'),
    );
  });

  it('renders the HTML: preheader, the role in bold, one button with its copy link, no delete-data link', async () => {
    const { html } = await renderEmail('member-invitation', data, ctx);
    expect(html).toContain('Accept to see what this role covers. The invitation expires on 27 Nov 2026.');
    expect(html).toContain('as <strong>Hiring owner</strong> for Senior AI Engineer.');
    expect(html).toContain('<strong>You can:</strong>');
    expect(html.match(/class="e-button"/g)).toHaveLength(1);
    expect(html.match(/href="https:\/\/credalent.example\/l\/9fK2xQ7mT4vB"/g)).toHaveLength(1);
    expect(html).not.toContain('Ask us to delete your data');
  });

  it.each([
    ['admin', 'as Workspace admin. Accept', 'You can: manage members and billing'],
    [
      'recruiter',
      'as Recruiter. Accept',
      'You cannot: invite members, change workspace settings or a job’s hiring owner.',
    ],
    ['interviewer', 'as Interviewer for Senior AI Engineer. Accept', 'You can: see the candidates you interview for'],
  ] as const)('the %s variant (ERoles)', async (role, intro, scopeLine) => {
    const scope = role === 'interviewer' ? 'Senior AI Engineer' : null;
    const { subject, text } = await renderEmail('member-invitation', { ...data, role, scope }, ctx);
    expect(subject).toBe('You are invited to Demo Hiring Co on Credalent');
    expect(text).toContain(intro);
    expect(text).toContain(scopeLine);
  });

  it('refuses a link that is not a URL, and an unknown role', () => {
    expect(memberInvitationData.safeParse({ ...data, link: 'javascript:alert(1)' }).success).toBe(false);
    expect(memberInvitationData.safeParse({ ...data, role: 'owner' }).success).toBe(false);
  });
});
