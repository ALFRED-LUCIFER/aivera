import { useTranslations } from '@aivera/i18n/react';
import { Checkbox } from '@aivera/ui';
import { possessive, type Option } from '../domain/members.ts';

type JobPickerProps = {
  jobs: Option[];
  /** An agency's clients; null for an in-house team, which has none. */
  clients: Option[] | null;
  defaultJobIds?: string[];
  defaultClientIds?: string[];
  /** Id of the error that says a job is needed. */
  errorId?: string | undefined;
};

/**
 * The jobs a hiring owner or interviewer works on: all of a client's jobs (agencies), or specific jobs. Posts `clientIds`
 * and `jobIds`. Used by the invite form and by "Edit jobs".
 */
export function JobPicker({ jobs, clients, defaultJobIds = [], defaultClientIds = [], errorId }: JobPickerProps) {
  const t = useTranslations('members.picker');
  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={errorId}>
      <legend className="mb-1 text-meta font-semibold text-text">{t('legend')}</legend>
      {clients?.map((c) => (
        <Checkbox
          key={c.value}
          name="clientIds"
          value={c.value}
          defaultChecked={defaultClientIds.includes(c.value)}
          label={t('allOfClient', { client: possessive(c.label) })}
        />
      ))}
      {jobs.map((j) => (
        <Checkbox
          key={j.value}
          name="jobIds"
          value={j.value}
          defaultChecked={defaultJobIds.includes(j.value)}
          label={j.label}
        />
      ))}
      {jobs.length === 0 && !clients?.length && <p className="text-meta text-text-2">{t('noJobs')}</p>}
    </fieldset>
  );
}
