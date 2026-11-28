// Deviations from the RoleNew artboard:
// - Re-drafting over edited competencies first shows the shared preview-confirm card listing what will be replaced
//   (AIV-P2-064, AGENTS.md 1.5).
// - Once there is a draft, "1. The job" collapses to one line (title and job type) with "Edit job details", so the
//   competencies lead; the artboard keeps the fields open (AIV-P1-165, #677 section 2).
// - Step 4 reads "4. You approve" in a workspace with no hiring owner, where the artboard reads "4. Hiring owner
//   approves": a recruiter approves the rubric herself (ADR-014, #677 section 2).
// - "Save job and rubric" is drawn only once there is a draft to save; the artboard draws it from the start (#677).
// - The job type follows the title until the recruiter picks one; the artboard starts from a fixed job type (#677).
import type { ReactNode } from 'react';
import { Button, Dialog, DialogClose, Input, Label, PreviewConfirmCard, Select, Textarea } from '@credalent/ui';
import {
  DESCRIPTION_MAX,
  descriptionPlaceholder,
  TEXT_MAX,
  type JobTypeOption,
  type NewJobState,
} from '../domain/jobNew.ts';

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
  /** The client picker's first option: the job is the agency's own (AIV-P1-056). */
  ourTeam: string;
  location: string;
  optional: string;
  hiringOwner: string;
  notChosen: string;
  noHiringOwner: string;
  inviteHiringOwner: string;
  /** "Edit job details": opens the job fields again once they have collapsed to their summary. */
  editDetails: string;
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
  errors: { title: string; jobType: string; failed: string; saveFailed: string; saveForbidden: string };
  redraft: { title: string; body: string; confirm: string; cancel: string; footer: string; unnamed: string };
};

type Option = { value: string; label: string };

type NewJobFormProps = {
  state: NewJobState;
  /** "Save job and rubric": saves the job with rubric version 1 as a draft (AIV-P1-010). */
  action: (form: FormData) => void;
  pending: boolean;
  /** The required fields to fix, from the last save or draft. */
  errors: NewJobState['errors'];
  /** "Draft competencies" reads the form without posting it, so nothing is saved. */
  onDraft: (form: HTMLFormElement) => void;
  /** The competencies a re-draft would replace, while its preview asks; null when no preview is open. */
  replacing: readonly string[] | null;
  onConfirmRedraft: () => void;
  onCancelRedraft: () => void;
  /** Save was chosen: false blocks it (a competency to fix). The errors shown are now the save's. */
  onSaving: () => boolean;
  /** The kept competencies, posted with the job as `rubric`. */
  rubric: string;
  drafting: boolean;
  /** Once competencies are drafted, saving is the step's primary action. */
  drafted: boolean;
  /** The recruiter reopened the job fields, which collapse to a one-line summary once there is a draft (AIV-P1-165). */
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  /** The title as typed, for the summary line. */
  title: string;
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
  /** The job types the published catalogue offers, each with its label, "evidence that counts" line and starters. */
  jobTypes: readonly JobTypeOption[];
  hiringOwners: readonly Option[];
  /** An agency's clients; null for an in-house team, which names a team instead. */
  clients: readonly Option[] | null;
  /** Members, for "Invite a hiring owner"; null where sending is off, since inviting is an email (AIV-P1-165). */
  membersHref: string | null;
  labels: NewJobLabels;
};

const id = (field: string) => `job-new-${field}`;
// Stable, so focus moves to the summary once, when the first draft arrives: "Draft competencies" is disabled while it
// drafts, which drops the focus it had.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

/** Add a job, step 1 "Job and description" (RoleNew artboard, AIV-P1-007). */
export function NewJobForm(props: NewJobFormProps) {
  const { state, errors, labels, jobType, pending } = props;
  const chosen = props.jobTypes.find((t) => t.value === jobType);
  const optional = <span className="ms-1 font-normal text-text-2">{labels.optional}</span>;
  // A field to fix is never hidden: the fields open again with their error.
  const collapsed = props.drafted && !props.detailsOpen && !errors.title && !errors.jobType;
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
          {labels.errors[state.error]}
        </p>
      )}
      {/* Keyed on the result, so a refused submit shows the fields again with what was typed. */}
      <form
        id={id('form')}
        key={JSON.stringify(state)}
        action={props.action}
        // Draft is the form's first submit button, so Enter in a field drafts; only Save posts the action.
        onSubmit={(e) => {
          if ((e.nativeEvent as SubmitEvent).submitter?.id === id('save')) {
            if (!props.onSaving()) e.preventDefault();
            return;
          }
          e.preventDefault();
          props.onDraft(e.currentTarget);
        }}
        onInput={props.onInput}
        noValidate
        className="flex max-w-2xl flex-col gap-3"
      >
        <input type="hidden" name="rubric" value={props.rubric} />
        {props.drafted && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p tabIndex={-1} ref={focusOnMount} className="text-body font-semibold text-text">
              {[props.title.trim(), chosen?.label].filter(Boolean).join(' · ')}
            </p>
            <Button
              size="compact"
              aria-expanded={!collapsed}
              aria-controls={id('fields')}
              onClick={() => props.onDetailsOpenChange(collapsed)}
            >
              {labels.editDetails}
            </Button>
          </div>
        )}
        {/* Hidden, not removed: Save posts the fields and Draft reads them while they are collapsed. */}
        <div id={id('fields')} hidden={collapsed} className="flex flex-col gap-3">
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
            {chosen?.evidence && ` ${labels.evidence} ${chosen.evidence}`}
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
            placeholder={descriptionPlaceholder(labels.placeholderIntro, chosen?.starters ?? [])}
            aria-describedby={id('description-hint')}
          />
          <p id={id('description-hint')} className="text-meta text-text-2">
            {labels.descriptionHint}
          </p>

          {props.clients ? (
            <>
              <Label htmlFor={id('client')}>{labels.client}</Label>
              <Select id={id('client')} name="clientId" defaultValue={state.values.clientId}>
                <option value="">{labels.ourTeam}</option>
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
              <p className="text-meta font-semibold text-text">
                {labels.hiringOwner}
                {optional}
              </p>
              <p className="text-body text-text-2">
                {labels.noHiringOwner}
                {props.membersHref && (
                  <>
                    {' '}
                    <a href={props.membersHref} className="font-semibold text-text underline underline-offset-2">
                      {labels.inviteHiringOwner}
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Outside the collapsing fields: a new draft is one Tab from the summary. */}
        <div className={collapsed ? 'flex flex-wrap gap-2' : 'mt-3 flex flex-wrap gap-2'}>
          <Button type="submit" variant={props.drafted ? 'secondary' : 'primary'} disabled={props.drafting}>
            {props.drafting ? labels.drafting : labels.submit}
          </Button>
        </div>
      </form>
      {props.draftSection}
      <div className="mt-6 flex flex-wrap gap-2">
        {/* Only once there is a draft to save (AIV-P1-165): until then "Draft competencies" is the one primary. */}
        {props.drafted && (
          <Button type="submit" id={id('save')} form={id('form')} variant="primary" disabled={pending}>
            {pending ? labels.submitting : labels.save}
          </Button>
        )}
        <Button onClick={props.onCancel}>{labels.cancel}</Button>
      </div>
      <PreviewConfirmCard
        open={props.replacing !== null}
        onOpenChange={(open) => !open && props.onCancelRedraft()}
        title={labels.redraft.title}
        confirmLabel={labels.redraft.confirm}
        pendingLabel={labels.drafting}
        cancelLabel={labels.redraft.cancel}
        footer={labels.redraft.footer}
        errorMessage={labels.errors.saveFailed}
        closeLabel={labels.close}
        onConfirm={props.onConfirmRedraft}
        onCancel={props.onCancelRedraft}
      >
        <p>{labels.redraft.body}</p>
        <ul className="mt-2 list-disc ps-5">
          {props.replacing?.map((name, i) => (
            <li key={i}>{name || labels.redraft.unnamed}</li>
          ))}
        </ul>
      </PreviewConfirmCard>
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
