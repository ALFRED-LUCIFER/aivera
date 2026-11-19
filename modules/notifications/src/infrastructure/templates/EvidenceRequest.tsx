import type { EvidenceRequestData } from '../../domain/email.ts';
import { Button, Callout, CopyLink, EmailLayout, Evidence, Heading, Text, type LayoutCopy } from './components.tsx';
import type { TemplateContext } from './render.ts';

// The "Email: evidence request" artboard (docs/01-design/artboards/EEvidence.dc.html), HTML and plain text.

export function evidenceRequest(data: EvidenceRequestData, { t, layout, sender }: TemplateContext) {
  const dir = layout.dir;
  const copy: LayoutCopy = {
    ...layout,
    title: t('emails.evidenceRequest.subject', { jobTitle: data.jobTitle }),
    preheader: t('emails.evidenceRequest.preheader'),
  };
  const intro = t('emails.evidenceRequest.intro', {
    recruiter: sender.name,
    workspace: sender.workspace,
    jobTitle: data.jobTitle,
  });
  const questions = t('emails.evidenceRequest.questions', { name: sender.shortName });
  const youSaid = t('emails.evidenceRequest.youSaid');
  const quoted = (claim: string) => t('emails.evidenceRequest.quoted', { claim });

  const element = (
    <EmailLayout copy={copy}>
      <Heading dir={dir}>{t('emails.evidenceRequest.heading')}</Heading>
      <Text dir={dir}>{intro}</Text>
      <Text dir={dir}>
        <strong>{t('emails.evidenceRequest.whatToSend')}</strong>
      </Text>
      <Text dir={dir}>
        <ul style={{ margin: 0, paddingInlineStart: '20px' }}>
          {data.items.map((item) => (
            <li key={item.competency} style={{ marginBottom: '8px' }}>
              <strong>{item.competency}.</strong>{' '}
              {item.claim && (
                <>
                  {youSaid} <Evidence>{quoted(item.claim)}</Evidence>{' '}
                </>
              )}
              {item.ask}
            </li>
          ))}
        </ul>
      </Text>
      <Callout dir={dir}>{t('emails.evidenceRequest.callout')}</Callout>
      <Button dir={dir} href={data.link}>
        {t('emails.evidenceRequest.button')}
      </Button>
      <CopyLink dir={dir} label={layout.copyLinkLabel} href={data.link} />
      <Text dir={dir}>{questions}</Text>
    </EmailLayout>
  );

  const text = [
    ...(layout.devBand ? [layout.devBand, ''] : []),
    layout.sentBy,
    '',
    t('emails.evidenceRequest.heading').toUpperCase(),
    '',
    intro,
    '',
    t('emails.evidenceRequest.whatToSend'),
    '',
    ...data.items.map(
      (item) => `- ${item.competency}. ${item.claim ? `${youSaid} ${quoted(item.claim)} ` : ''}${item.ask}`,
    ),
    '',
    `${layout.noteLabel} ${t('emails.evidenceRequest.callout')}`,
    '',
    `${t('emails.evidenceRequest.button')}:`,
    data.link,
    '',
    questions,
  ];

  return { subject: copy.title, element, text };
}
