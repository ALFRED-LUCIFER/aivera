import { Button, Input, Label, Select } from '@aivera/ui';
import type { CreateWorkspaceState, HiringFocus } from '../domain/signup.ts';

export type CreateWorkspaceLabels = {
  title: string;
  company: string;
  optional: string;
  companyHint: string;
  hiringFocus: string;
  choose: string;
  submit: string;
  failed: string;
};

type CreateWorkspaceFormProps = {
  action: (form: FormData) => void;
  state: CreateWorkspaceState;
  pending: boolean;
  /** Each hiring focus with its label, already translated. */
  focusOptions: readonly { value: HiringFocus; label: string }[];
  labels: CreateWorkspaceLabels;
};

// shortcut: no "In-house team or agency?" choice; every workspace starts in-house and an admin makes it an agency with
// setWorkspaceType (AIV-P0-906). Add the choice here once a ticket asks for it on sign-up.
/** "Create your workspace" for a signed-in user with no workspace (SignUp artboard, AIV-P1-001, AIV-P1-068). */
export function CreateWorkspaceForm({ action, state, pending, focusOptions, labels }: CreateWorkspaceFormProps) {
  return (
    <section aria-labelledby="create-workspace-title" className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 id="create-workspace-title" className="font-display text-section text-text">
        {labels.title}
      </h2>
      {state.error && (
        <p role="alert" className="text-body text-text">
          {labels.failed}
        </p>
      )}
      {/* Keyed on the result, so a failed submit shows the fields again with what was typed. */}
      <form key={JSON.stringify(state)} action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-workspace-company">
            {labels.company} <span className="ms-1 font-normal text-text-2">{labels.optional}</span>
          </Label>
          <Input
            id="create-workspace-company"
            name="company"
            autoComplete="organization"
            maxLength={200}
            defaultValue={state.values.company}
            className="min-h-11"
            aria-describedby="create-workspace-company-hint"
          />
          <p id="create-workspace-company-hint" className="text-meta text-text-2">
            {labels.companyHint}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-workspace-focus">{labels.hiringFocus}</Label>
          <Select
            id="create-workspace-focus"
            name="hiringFocus"
            required
            defaultValue={state.values.hiringFocus}
            className="min-h-11"
          >
            <option value="" disabled>
              {labels.choose}
            </option>
            {focusOptions.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary" size="large" disabled={pending}>
          {labels.submit}
        </Button>
      </form>
    </section>
  );
}
