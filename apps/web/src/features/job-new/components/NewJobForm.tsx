import type { ReactNode } from 'react';
import { Button, Dialog, DialogClose, Input, Label, Select, Textarea } from '@aivera/ui';
import { DESCRIPTION_MAX, descriptionPlaceholder, TEXT_MAX, type NewJobState } from '../domain/jobNew.ts';

type NewJobLabels = {
  steps: string;
  stepList: readonly [string, string, string, string];
  jobType: string;
  jobTypeHint: string;
  chooseJobType: string;
  evidence: string;
  title: string;
  description: string;
  descriptionHint: string;
  placeholderIntro: string;
  team: string;
  client: string;
  location: string;
  optional: string;
  hiringOwner: string;
  notChosen: string;
  noHiringOwner: string;
  inviteHiringOwner: string;
  submit: string;
  drafting: string;
  save: string;
  submitting: string;
  cancel: string;
  discardTitle: string;
  discardBody: string;
  discard: string;
  keepEditing: string;
  close: string;
  errors: { title: string; jobType: string; failed: string };
};

type Option = { value: string; label: string };

type NewJobFormProps = {
  state: NewJobState;
  /** Saves the job (step 1 only; the rubric is saved with it from AIV-P1-010). */
  action: (form: FormData) => void;
  pending: boolean;
  /** The required fields to fix, from the last save or draft. */
  errors: NewJobState['errors'];
  /** "Draft competencies" reads the form without submitting it, so nothing is saved. */
  onDraft: (form: HTMLFormElement | null) => void;
  drafting: boolean;
  /** Once competencies are drafted, saving is the step's primary action. */
  drafted: boolean;
  onTitleChange: (title: string) => void;
  /** Step 2, between the job fields and Save. */
  draftSection: ReactNode;
  jobType: string;
  onJobTypeChange: (jobType: string) => void;
  onInput: () => void;
  onCancel: () => void;
  discardOpen: boolean;
  onDiscardOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  /** The ten job types, each with its label and "evidence that counts" line, translated. */
  jobTypes: readonly (Option & { evidence: string })[];
  hiringOwners: readonly Option[];
  /** An agency's clients; null for an in-house team, which names a team instead. */
  clients: readonly Option[] | null;
  /** Where "Invite a hiring owner" goes. */
  membersHref: string;
  labels: NewJobLabels;
};

const id = (field: string) => `job-new-${field}`;

/** Add a job, step 1 "Job and description" (RoleNew artboard, AIV-P1-007). */
export function NewJobForm(props: NewJobFormProps) {
  const { state, errors, labels, jobType, pending } = props;
  const evidence = props.jobTypes.find((t) => t.value === jobType)?.evidence;
  const optional = <span className="ms-1 font-normal text-text-2">{labels.optional}</span>;
  return (
    <>
      <nav aria-label={labels.steps} className="mb-6">
        <ol className="flex flex-wrap gap-x-6 gap-y-1 text-meta text-text-2">
          {labels.stepList.map((step, i) => (
            <li
              key={step}
              aria-current={i === (props.drafted ? 1 : 0) ? 'step' : undefined}
              className={i === (props.drafted ? 1 : 0) ? 'font-semibold text-text' : ''}
            >
              {step}
            </li>
          ))}
        </ol>
      </nav>
      {state.error && (
        <p role="alert" className="mb-4 text-body text-text">
          {labels.errors.failed}
        </p>
      )}
      {/* Keyed on the result, so a refused submit shows the fields again with what was typed. */}
      <form
        id={id('form')}
        key={JSON.stringify(state)}
        action={props.action}
        onInput={props.onInput}
        noValidate
        className="flex max-w-2xl flex-col gap-3"
      >
        <Label htmlFor={id('type')}>{labels.jobType}</Label>
        <Select
          id={id('type')}
          name="jobType"
          value={jobType}
          onChange={(e) => props.onJobTypeChange(e.target.value)}
          aria-required="true"
          aria-invalid={errors.jobType || undefined}
          aria-describedby={`${id('type-hint')}${errors.jobType ? ` ${id('type-error')}` : ''}`}
        >
          <option value="" disabled>
            {labels.chooseJobType}
          </option>
          {props.jobTypes.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <p id={id('type-hint')} className="text-meta text-text-2">
          {labels.jobTypeHint}
          {evidence && ` ${labels.evidence} ${evidence}`}
        </p>
        {errors.jobType && (
          <p id={id('type-error')} role="alert" className="text-meta font-semibold text-err-text">
            {labels.errors.jobType}
          </p>
        )}

        <Label htmlFor={id('title')}>{labels.title}</Label>
        <Input
          id={id('title')}
          name="title"
          maxLength={TEXT_MAX}
          defaultValue={state.values.title}
          onChange={(e) => props.onTitleChange(e.target.value)}
          aria-required="true"
          aria-invalid={errors.title || undefined}
          aria-describedby={errors.title ? id('title-error') : undefined}
        />
        {errors.title && (
          <p id={id('title-error')} role="alert" className="text-meta font-semibold text-err-text">
            {labels.errors.title}
          </p>
        )}

        <Label htmlFor={id('description')}>{labels.description}</Label>
        <Textarea
          id={id('description')}
          name="description"
          rows={8}
          maxLength={DESCRIPTION_MAX}
          defaultValue={state.values.description}
          placeholder={descriptionPlaceholder(labels.placeholderIntro, jobType)}
          aria-describedby={id('description-hint')}
        />
        <p id={id('description-hint')} className="text-meta text-text-2">
          {labels.descriptionHint}
        </p>

        {props.clients ? (
          <>
            <Label htmlFor={id('client')}>
              {labels.client}
              {optional}
            </Label>
            <Select id={id('client')} name="clientId" defaultValue={state.values.clientId}>
              <option value="">{labels.notChosen}</option>
              {props.clients.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <Label htmlFor={id('team')}>
              {labels.team}
              {optional}
            </Label>
            <Input id={id('team')} name="team" maxLength={TEXT_MAX} defaultValue={state.values.team} />
          </>
        )}

        <Label htmlFor={id('location')}>
          {labels.location}
          {optional}
        </Label>
        <Input id={id('location')} name="location" maxLength={TEXT_MAX} defaultValue={state.values.location} />

        {props.hiringOwners.length ? (
          <>
            <Label htmlFor={id('owner')}>
              {labels.hiringOwner}
              {optional}
            </Label>
            <Select id={id('owner')} name="hiringOwnerUserId" defaultValue={state.values.hiringOwnerUserId}>
              <option value="">{labels.notChosen}</option>
              {props.hiringOwners.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-meta font-semibold text-text">{labels.hiringOwner}</p>
            <p className="text-body text-text-2">
              {labels.noHiringOwner}{' '}
              <a href={props.membersHref} className="font-semibold text-text underline underline-offset-2">
                {labels.inviteHiringOwner}
              </a>
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={props.drafted ? 'secondary' : 'primary'}
            disabled={props.drafting}
            onClick={(e) => props.onDraft(e.currentTarget.form)}
          >
            {props.drafting ? labels.drafting : labels.submit}
          </Button>
        </div>
      </form>
      {props.draftSection}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="submit" form={id('form')} variant={props.drafted ? 'primary' : 'secondary'} disabled={pending}>
          {pending ? labels.submitting : labels.save}
        </Button>
        <Button onClick={props.onCancel}>{labels.cancel}</Button>
      </div>
      <Dialog
        open={props.discardOpen}
        onOpenChange={props.onDiscardOpenChange}
        title={labels.discardTitle}
        description={labels.discardBody}
        closeLabel={labels.close}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button>{labels.keepEditing}</Button>
          </DialogClose>
          <Button onClick={props.onDiscard}>{labels.discard}</Button>
        </div>
      </Dialog>
    </>
  );
}
