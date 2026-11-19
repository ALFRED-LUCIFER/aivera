import { useTranslations } from '@aivera/i18n/react';
import { Button, Card, Input, Label, Select } from '@aivera/ui';
import type { JobType } from '@aivera/jobs';
import Link from 'next/link';
import { CANDIDATE_SIGN_IN } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import type { SignUpState, SignUpStep } from '../domain/signup.ts';

export type CandidateSignUpProps = {
  /** Signed out: the buttons that start the candidate user flow. Profile: the full name and work type form. */
  step: Exclude<SignUpStep, 'done'>;
  /** The server action that starts the candidate sign-in at the tenant (AIV-P0-011). */
  startAction: (form: FormData) => Promise<void>;
  /** Where the tenant returns to: this page. */
  next: string;
  workTypes: readonly JobType[];
  /** Shows "Create account and start Plus" (feature flag, until AIV-P4-004). */
  plusEnabled: boolean;
  /** The Plus price, already formatted. */
  plusPrice: string;
  /** The profile form's posted action, its last result and whether it is running. */
  action: (form: FormData) => void;
  state: SignUpState;
  pending: boolean;
};

const PERKS = ['jobs', 'applications', 'cvCheck', 'requests'] as const;

// The CSignUp artboard: the form on the start side, "What you get, free" beside it (stacked when narrow). Email,
// password and verification are on the tenant's page, so the app shows no email or password field.
export function CandidateSignUp(props: CandidateSignUpProps) {
  const t = useTranslations('candidate.signup');
  return (
    <div className="flex max-w-245 flex-wrap items-start gap-x-14 gap-y-8">
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-title tracking-tight">{t('title')}</h1>
          <p className="text-body text-text-2">
            {t('lead')} {t('free')}
          </p>
        </div>
        {props.step === 'signedOut' ? <Start {...props} /> : <Profile {...props} />}
      </div>
      <Card title={t('perks.title')} level={2} className="min-w-0 flex-[1_1_320px]">
        <ul className="flex flex-col gap-3">
          {PERKS.map((key) => (
            <li key={key} className="flex items-start gap-2.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                aria-hidden
                className="mt-0.5 size-4 flex-none"
              >
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              <span>{t(`perks.${key}`)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-border pt-3 text-meta text-text-2">{t('sharing')}</p>
      </Card>
    </div>
  );
}

function Start({ startAction, next }: CandidateSignUpProps) {
  const t = useTranslations('candidate.signup');
  return (
    <>
      {/* Both open the candidate user flow, where email with password or Google is chosen; no email in the URL. */}
      <form action={startAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="primary">
          {t('create')}
        </Button>
        <Button type="submit">{t('google')}</Button>
      </form>
      <p className="text-text-2">
        {t('haveAccount')}{' '}
        <Link href={CANDIDATE_SIGN_IN} className="font-semibold text-text underline underline-offset-3">
          {t('signIn')}
        </Link>
      </p>
    </>
  );
}

function Profile({ workTypes, plusEnabled, plusPrice, action, state, pending }: CandidateSignUpProps) {
  const t = useTranslations();
  const error = (field: keyof SignUpState['errors']) => {
    const key = state.errors[field];
    return key ? (
      <p id={`signup-${field}-error`} className="text-meta font-semibold text-text">
        {t(`candidate.signup.errors.${key}`)}
      </p>
    ) : null;
  };
  const described = (field: keyof SignUpState['errors'], hint?: string) =>
    [state.errors[field] && `signup-${field}-error`, hint].filter(Boolean).join(' ') || undefined;
  return (
    <>
      {state.failed && (
        <p role="alert" className="text-body text-text">
          {t('candidate.signup.errors.failed')}
        </p>
      )}
      {/* Validated on the server (the same zod schema), so each message comes from i18n, next to its field. Keyed on
          the result, so a refused submit shows the fields again with what was typed. */}
      <form key={JSON.stringify(state)} action={action} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-fullName">{t('candidate.signup.fullName')}</Label>
          <Input
            id="signup-fullName"
            name="fullName"
            autoComplete="name"
            maxLength={200}
            aria-required
            aria-invalid={Boolean(state.errors.fullName) || undefined}
            aria-describedby={described('fullName')}
            defaultValue={state.values.fullName}
          />
          {error('fullName')}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-workType">{t('candidate.signup.workType')}</Label>
          <Select
            id="signup-workType"
            name="workType"
            aria-required
            aria-invalid={Boolean(state.errors.workType) || undefined}
            aria-describedby={described('workType', 'signup-workType-hint')}
            defaultValue={state.values.workType}
          >
            <option value="" disabled>
              {t('candidate.signup.choose')}
            </option>
            {workTypes.map((key) => (
              <option key={key} value={key}>
                {t(`jobTypes.${key}.label`)}
              </option>
            ))}
          </Select>
          <p id="signup-workType-hint" className="text-meta text-text-2">
            {t('candidate.signup.workTypeHint')}
          </p>
          {error('workType')}
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('candidate.signup.create')}
        </Button>
        {/* shortcut: submits the same free sign-up; AIV-P4-004 sends it on to payment before its flag is turned on. */}
        {plusEnabled && (
          <Button type="submit" disabled={pending}>
            {t('candidate.signup.createWithPlus', { price: plusPrice })}
          </Button>
        )}
      </form>
    </>
  );
}
