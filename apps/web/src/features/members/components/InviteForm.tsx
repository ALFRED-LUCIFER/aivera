import { useTranslations } from '@credalent/i18n/react';
import { ROLES, type Role } from '@credalent/workspaces';
import { Button, Input, Label, Select } from '@credalent/ui';
import type { InviteState, Option } from '../domain/members.ts';
import { JobPicker } from './JobPicker.tsx';

type InviteFormProps = {
  action: (form: FormData) => void;
  state: InviteState;
  pending: boolean;
  role: Role;
  onRoleChange: (role: Role) => void;
  showPicker: boolean;
  jobs: Option[];
  clients: Option[] | null;
};

/** "Invite someone": email, role, the title shown in the app, and for hiring owners and interviewers their jobs. */
export function InviteForm({ action, state, pending, role, onRoleChange, showPicker, jobs, clients }: InviteFormProps) {
  const t = useTranslations('members');
  return (
    <section aria-labelledby="invite-title" className="flex flex-col gap-3">
      <h2 id="invite-title" className="font-display text-section text-text">
        {t('invite.title')}
      </h2>
      <output className="block text-body text-text">
        {state.invited &&
          t('invite.sent', { email: state.invited.email, expiresAt: new Date(state.invited.expiresAt) })}
      </output>
      {/* Keyed on the result, so a refused submit shows what was typed and a sent one clears the form. */}
      <form key={JSON.stringify(state)} action={action} className="flex max-w-lg flex-col gap-3">
        <Label htmlFor="invite-email">{t('invite.email')}</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          defaultValue={state.values.email}
          aria-invalid={state.error === 'email' || undefined}
          aria-describedby={state.error === 'email' ? 'invite-error' : undefined}
        />
        <Label htmlFor="invite-role">{t('invite.role')}</Label>
        <Select
          id="invite-role"
          name="role"
          value={role}
          onChange={(event) => onRoleChange(event.target.value as Role)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
        <Label htmlFor="invite-title-field">
          {t('invite.jobTitle')} <span className="ms-1 font-normal text-text-2">{t('invite.optional')}</span>
        </Label>
        <Input
          id="invite-title-field"
          name="title"
          maxLength={120}
          defaultValue={state.values.title}
          aria-describedby="invite-title-hint"
        />
        <p id="invite-title-hint" className="text-meta text-text-2">
          {t('invite.jobTitleHint')}
        </p>
        {showPicker ? (
          <JobPicker
            jobs={jobs}
            clients={clients}
            errorId={state.error === 'jobsRequired' ? 'invite-error' : undefined}
          />
        ) : (
          <p className="text-meta text-text-2">{t('invite.allJobs')}</p>
        )}
        {state.error && (
          <p id="invite-error" role="alert" className="text-body text-err-text">
            {t(`invite.errors.${state.error}`)}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {t('invite.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** "Invite someone" while outbound email is off (OUTBOUND, AIV-P1-165): one plain line instead of a form that fails. */
export function InvitesOff() {
  const t = useTranslations('members');
  return (
    <section aria-labelledby="invite-title" className="flex flex-col gap-3">
      <h2 id="invite-title" className="font-display text-section text-text">
        {t('invite.title')}
      </h2>
      <p className="text-body text-text-2">{t('invite.off')}</p>
    </section>
  );
}
