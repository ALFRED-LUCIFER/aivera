import { dir as directionOf, getTranslations, type Locale } from '@aivera/i18n';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import type { Sender, TemplateData, TemplateName } from '../../domain/email.ts';
import type { Direction, LayoutCopy } from './components.tsx';
import { evidenceRequest } from './EvidenceRequest.tsx';
import { memberInvitation } from './MemberInvitation.tsx';
import { rubricApproval, rubricApproved, rubricReturned } from './Rubric.tsx';

// Renders a template to subject, HTML and plain text with React Email, every string from packages/i18n.
// Loaded only where an email is queued (the web app); the worker sends what was rendered and never imports JSX.

export type Rendered = { subject: string; html: string; text: string };

export type RenderContext = {
  locale: Locale;
  timeZone: string;
  /** The web app's public origin, for the hosted logo and the privacy page. */
  origin: string;
  /** Adds the synthetic-data band: every environment but the pilot and production (AGENTS.md 1.1). */
  synthetic: boolean;
  sender: Sender;
};

type Translator = Awaited<ReturnType<typeof getTranslations>>;
export type TemplateContext = {
  t: Translator;
  sender: Sender;
  layout: Omit<LayoutCopy, 'title' | 'preheader'> & { copyLinkLabel: string; noteLabel: string };
};

const TEMPLATES: {
  [T in TemplateName]: (
    data: TemplateData[T],
    context: TemplateContext,
  ) => { subject: string; element: ReactElement; text: string[] };
} = {
  'evidence-request': evidenceRequest,
  'member-invitation': memberInvitation,
  'rubric-approval': rubricApproval,
  'rubric-approved': rubricApproved,
  'rubric-returned': rubricReturned,
};

/** Why the recipient gets the email: a member was invited, a member's job needs them, or a candidate applied. */
const REASONS = {
  'evidence-request': 'emails.layout.reasonCandidate',
  'member-invitation': 'emails.layout.reasonInvited',
  'rubric-approval': 'emails.layout.reasonMember',
  'rubric-approved': 'emails.layout.reasonMember',
  'rubric-returned': 'emails.layout.reasonMember',
} as const satisfies Record<TemplateName, string>;

export async function renderEmail<T extends TemplateName>(
  template: T,
  data: TemplateData[T],
  ctx: RenderContext,
): Promise<Rendered> {
  const t = await getTranslations(ctx.locale, ctx.timeZone);
  const privacyUrl = `${ctx.origin}/privacy`;
  const replies = t('emails.layout.repliesGoTo', { name: ctx.sender.name });
  const reason = t(REASONS[template as TemplateName]);
  // Only a candidate's email carries their signed "Ask us to delete your data" link; a member's has none.
  const deleteData = 'deleteUrl' in data && { label: t('emails.layout.deleteData'), href: data.deleteUrl };
  const layout: TemplateContext['layout'] = {
    lang: ctx.locale,
    dir: directionOf(ctx.locale) as Direction,
    logoUrl: `${ctx.origin}/brand/aivera-mark.png`,
    logoAlt: t('emails.layout.logoAlt'),
    brand: t('emails.layout.brand'),
    sentBy: t('emails.layout.sentBy', { sender: ctx.sender.name, workspace: ctx.sender.workspace }),
    devBand: ctx.synthetic ? t('emails.layout.devBand') : null,
    footer: {
      workspace: ctx.sender.workspace,
      reason,
      replies,
      links: [{ label: t('emails.layout.privacy'), href: privacyUrl }, ...(deleteData ? [deleteData] : [])],
    },
    copyLinkLabel: t('emails.layout.copyLink'),
    noteLabel: t('emails.layout.note'),
  };
  const { subject, element, text } = TEMPLATES[template](data, { t, layout, sender: ctx.sender });
  const footer = [
    '',
    '--',
    ctx.sender.workspace,
    reason,
    replies,
    `${t('emails.layout.privacy')}: ${privacyUrl}`,
    ...(deleteData ? [`${deleteData.label}: ${deleteData.href}`] : []),
  ];
  return { subject, html: await render(element), text: [...text, ...footer].join('\n') };
}
