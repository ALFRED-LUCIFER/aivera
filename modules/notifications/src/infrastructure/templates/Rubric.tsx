import type { ReactNode } from 'react';
import type { RubricApprovalData, RubricApprovedData, RubricReturnedData } from '../../domain/email.ts';
import {
  Button,
  Callout,
  ChangeList,
  CompetencyTable,
  CopyLink,
  EmailLayout,
  Heading,
  QuotedNote,
  Required,
  requiredText,
  StatusLine,
  Text,
  type LayoutCopy,
} from './components.tsx';
import type { TemplateContext } from './render.ts';

// The rubric approval emails (AIV-P1-014), HTML and plain text: "Email: Rubric approval request", "Rubric approved" and
// "Rubric returned with a note" (docs/01-design/artboards/ERubric, EApproved, EReturned). Deviations: EApproved's
// "Assessment has started" reads "Assessment can now start", and "Candidates in the inbox … are now being assessed" is
// left out, until assessment runs on RubricApproved.v1 (AIV-P1-031); ERubric shows the change note as one row, as the rubric page does, not split per change. ENewer is the
// rubric page's own "A newer version is waiting for you" notice: opening a link sends no email. The highlighter marks
// what the recipient must act on (DESIGN.md): the owner's decision, the recruiter's change; an approval needs nothing.

const text = (layout: TemplateContext['layout'], lines: string[]) => [
  ...(layout.devBand ? [layout.devBand, ''] : []),
  layout.sentBy,
  '',
  ...lines,
];

/** To the hiring owner, from the recruiter who sent it: the competencies, what changed, and the link to approve. */
export function rubricApproval(data: RubricApprovalData, { t, layout, sender }: TemplateContext) {
  const { dir } = layout;
  const k = 'emails.rubricApproval';
  const copy: LayoutCopy = {
    ...layout,
    title: t(`${k}.subject`, { jobTitle: data.jobTitle }),
    preheader: t(`${k}.preheader`, { version: data.version, changed: data.changes ? 'yes' : 'no' }),
  };
  const heading = t(`${k}.heading`, { jobTitle: data.jobTitle, version: data.version });
  const introValues = { sender: sender.name, workspace: sender.workspace, version: data.version };
  const headers: [string, string, string] = [t(`${k}.competency`), t(`${k}.weight`), t(`${k}.level`)];
  const rows = data.competencies.map((c): [string, string, string] => [
    c.name,
    t(`${k}.weightValue`, { weight: c.weightPercent }),
    t(`${k}.levelValue`, { level: c.levelNeeded }),
  ]);
  const changedSince = data.changes && t(`${k}.changedSince`, { version: data.changes.since });
  const changed = t(`${k}.changed`);
  const callout = t(`${k}.callout`);
  const button = t(`${k}.button`);

  const element = (
    <EmailLayout copy={copy}>
      <Heading dir={dir}>{heading}</Heading>
      <Text dir={dir}>
        {t.rich(`${k}.intro`, { ...introValues, hl: (chunks: ReactNode) => <Required>{chunks}</Required> })}
      </Text>
      <CompetencyTable dir={dir} headers={headers} rows={rows} />
      {data.changes && changedSince && (
        <>
          <Text dir={dir}>
            <strong>{changedSince}</strong>
          </Text>
          <ChangeList dir={dir} label={changed} items={[data.changes.note]} />
        </>
      )}
      <Callout dir={dir}>{callout}</Callout>
      <Button dir={dir} href={data.link}>
        {button}
      </Button>
      <CopyLink dir={dir} label={layout.copyLinkLabel} href={data.link} />
    </EmailLayout>
  );

  const lines = text(layout, [
    heading.toUpperCase(),
    '',
    t.markup(`${k}.intro`, { ...introValues, hl: requiredText }),
    '',
    headers.join(' | '),
    ...rows.map((r) => r.join(' | ')),
    ...(data.changes && changedSince ? ['', changedSince, `- ${changed}: ${data.changes.note}`] : []),
    '',
    `${layout.noteLabel} ${callout}`,
    '',
    `${button}:`,
    data.link,
  ]);
  return { subject: copy.title, element, text: lines };
}

/** To the recruiter who sent it, from the hiring owner: the version is approved and assessment can start. */
export function rubricApproved(data: RubricApprovedData, { t, layout, sender }: TemplateContext) {
  const { dir } = layout;
  const k = 'emails.rubricApproved';
  const copy: LayoutCopy = {
    ...layout,
    title: t(`${k}.subject`, { jobTitle: data.jobTitle }),
    preheader: t(`${k}.preheader`, { version: data.version }),
  };
  const status = t(`${k}.status`);
  const version = t(`${k}.version`, { version: data.version });
  const heading = t(`${k}.heading`, { jobTitle: data.jobTitle });
  const body = t(`${k}.body`, { approver: sender.name, version: data.version, approvedAt: data.approvedAt });
  const next = t(`${k}.next`);
  const button = t(`${k}.button`);

  const element = (
    <EmailLayout copy={copy}>
      <StatusLine dir={dir} status="approved" label={status} detail={version} />
      <Heading dir={dir}>{heading}</Heading>
      <Text dir={dir}>{body}</Text>
      <Text dir={dir}>{next}</Text>
      <Button dir={dir} href={data.link}>
        {button}
      </Button>
      <CopyLink dir={dir} label={layout.copyLinkLabel} href={data.link} />
    </EmailLayout>
  );

  const lines = text(layout, [
    `${status} · ${version}`,
    '',
    heading.toUpperCase(),
    '',
    body,
    '',
    next,
    '',
    `${button}:`,
    data.link,
  ]);
  return { subject: copy.title, element, text: lines };
}

/** To the recruiter who sent it, from the hiring owner: returned with their note; the approved version stays. */
export function rubricReturned(data: RubricReturnedData, { t, layout, sender }: TemplateContext) {
  const { dir } = layout;
  const k = 'emails.rubricReturned';
  const inForce = data.inForce ? 'yes' : 'no';
  const copy: LayoutCopy = {
    ...layout,
    title: t(`${k}.subject`, { jobTitle: data.jobTitle }),
    preheader: t(`${k}.preheader`, { version: data.version, inForce }),
  };
  const status = t(`${k}.status`);
  const version = t(`${k}.version`, { version: data.version });
  const heading = t(`${k}.heading`, { owner: sender.name, version: data.version });
  const intro = t(`${k}.intro`, { owner: sender.name, version: data.version, jobTitle: data.jobTitle });
  const noteFrom = t(`${k}.noteFrom`, { owner: sender.name });
  const note = t(`${k}.quoted`, { note: data.note });
  const callout = t(`${k}.callout`, { inForce });
  const button = t(`${k}.button`);

  const element = (
    <EmailLayout copy={copy}>
      <StatusLine dir={dir} status="returned" label={status} detail={version} />
      <Heading dir={dir}>{heading}</Heading>
      <Text dir={dir}>{intro}</Text>
      <QuotedNote dir={dir} label={noteFrom} note={<Required>{note}</Required>} />
      <Callout dir={dir}>{callout}</Callout>
      <Button dir={dir} href={data.link}>
        {button}
      </Button>
      <CopyLink dir={dir} label={layout.copyLinkLabel} href={data.link} />
    </EmailLayout>
  );

  const lines = text(layout, [
    `${status} · ${version}`,
    '',
    heading.toUpperCase(),
    '',
    intro,
    '',
    noteFrom,
    requiredText(note),
    '',
    `${layout.noteLabel} ${callout}`,
    '',
    `${button}:`,
    data.link,
  ]);
  return { subject: copy.title, element, text: lines };
}
