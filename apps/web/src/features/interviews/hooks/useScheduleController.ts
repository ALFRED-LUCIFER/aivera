import { useTimeZone } from '@credalent/i18n/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { InterviewRow } from '../domain/interviews.ts';
import {
  scheduleProblem,
  zonedToUtc,
  type InterviewerOption,
  type ScheduleError,
  type ScheduleView,
} from '../domain/schedule.ts';
import * as actions from '../services/scheduleInterview.ts';

/**
 * The Schedule dialog on the Interviews page (AIV-P2-007): date and time in the viewer's time zone, the interviewer,
 * and Save, the only thing that writes. A refusal or clash keeps the dialog open with what was entered.
 */
export function useScheduleController(
  interviewers: InterviewerOption[],
  services: Pick<typeof actions, 'scheduleInterview'> = actions,
): ScheduleView {
  const router = useRouter();
  const timeZone = useTimeZone();
  const [row, setRow] = useState<InterviewRow | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [interviewerUserId, setInterviewer] = useState('');
  const [error, setError] = useState<ScheduleError | null>(null);
  const [clashAt, setClashAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const edited =
    <T>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setError(null);
      setClashAt(null);
    };

  return {
    interviewers,
    row,
    onOpen(opened) {
      setRow(opened);
      setDate('');
      setTime('');
      setInterviewer(opened.interviewerUserId);
      setError(null);
      setClashAt(null);
      setDone(false);
    },
    onClose: () => setRow(null),
    date,
    onDateChange: edited(setDate),
    time,
    onTimeChange: edited(setTime),
    timeZone,
    interviewerUserId,
    onInterviewerChange: edited(setInterviewer),
    error,
    clashAt,
    pending,
    async onSave(keepClash = false) {
      if (!row) return;
      const at = zonedToUtc(date, time, timeZone);
      const problem = scheduleProblem(at, interviewerUserId, new Date());
      if (problem || !at) {
        setError(problem ?? 'pastTime');
        return;
      }
      setPending(true);
      try {
        const result = await services.scheduleInterview({
          interviewId: row.id,
          scheduledAt: at.toISOString(),
          interviewerUserId,
          keepClash,
        });
        if (result.ok) {
          setRow(null);
          setDone(true);
          router.refresh();
        } else if (result.error === 'clash') setClashAt(result.clashAt);
        else setError(result.error);
      } catch {
        setError('failed');
      } finally {
        setPending(false);
      }
    },
    done,
  };
}
