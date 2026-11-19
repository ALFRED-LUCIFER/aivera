import type { ReactNode } from 'react';
import type { MemberInvitationData } from '../../domain/email.ts';
import { Button, Callout, CopyLink, EmailLayout, Heading, Text, type LayoutCopy } from './components.tsx';
import type { TemplateContext } from './render.ts';

// The "Email: workspace invitation" artboard (docs/01-design/artboards/EInvite.dc.html) and its four role variants
// (ERoles.dc.html), HTML and plain text: only the role, its jobs and what it can and cannot see change.

export function memberInvitation(data: MemberInvitationData, { t, layout, sender }: TemplateContext) {
  const dir = layout.dir;
  const workspace = sender.workspace;
  const copy: LayoutCopy = {
    ...layout,
    title: t('emails.memberInvitation.subject', { workspace }),
    preheader: t('emails.memberInvitation.preheader', { expiresAt: data.expiresAt }),
  };
  const heading = t('emails.memberInvitation.heading', { inviter: sender.name, workspace });
  const intro = {
    inviter: sender.name,
    workspace,
    role: t(`members.roles.${data.role}`),
    scoped: data.scope ? 'yes' : 'no',
    scope: data.scope ?? '',
  };
  const can = t(`emails.memberInvitation.can.${data.role}`, { scope: data.scope ?? '' });
  const cannot = t(`emails.memberInvitation.cannot.${data.role}`);
  const youCan = t('emails.memberInvitation.youCan');
  const youCannot = t('emails.memberInvitation.youCannot');
  const expires = t('emails.memberInvitation.expires', { expiresAt: data.expiresAt });
  const button = t('emails.memberInvitation.button');

  const element = (
    <EmailLayout copy={copy}>
      <Heading dir={dir}>{heading}</Heading>
      <Text dir={dir}>
        {t.rich('emails.memberInvitation.intro', { ...intro, b: (chunks: ReactNode) => <strong>{chunks}</strong> })}
      </Text>
      <Text dir={dir}>
        <strong>{youCan}</strong> {can}
      </Text>
      <Text dir={dir}>
        <strong>{youCannot}</strong> {cannot}
      </Text>
      <Callout dir={dir}>{expires}</Callout>
      <Button dir={dir} href={data.link}>
        {button}
      </Button>
      <CopyLink dir={dir} label={layout.copyLinkLabel} href={data.link} />
    </EmailLayout>
  );

  const text = [
    ...(layout.devBand ? [layout.devBand, ''] : []),
    layout.sentBy,
    '',
    heading.toUpperCase(),
    '',
    t.markup('emails.memberInvitation.intro', { ...intro, b: (chunks) => chunks }),
    '',
    `${youCan} ${can}`,
    '',
    `${youCannot} ${cannot}`,
    '',
    `${layout.noteLabel} ${expires}`,
    '',
    `${button}:`,
    data.link,
  ];

  return { subject: copy.title, element, text };
}
