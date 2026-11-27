import { z } from 'zod';
import type { InterviewRow } from './interviews.ts';

// AIV-P2-007: giving an interview its time and interviewer from the Interviews page. Nobody is contacted.

/** A person the dialog offers as interviewer: their user id and name. */
export type InterviewerOption = { value: string; label: string };

/** What the dialog posts; the time is the UTC instant of the date and time the person chose in their time zone. */
export const scheduleSchema = z.strictObject({
  interviewId: z.uuid(),
  scheduledAt: z.iso.datetime(),
  interviewerUserId: z.uuid(),
  keepClash: z.boolean(),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export type ScheduleError = 'pastTime' | 'noInterviewer' | 'notOnJob' | 'hasDraft' | 'changed' | 'failed';
export type ScheduleResult =
  | { ok: true }
  | { ok: false; error: ScheduleError }
  /** The interviewer already has an interview within the hour of `clashAt` (ISO); nothing was written. */
  | { ok: false; error: 'clash'; clashAt: string };

/**
 * The UTC instant of a wall-clock `date` (YYYY-MM-DD) and `time` (HH:MM) in `timeZone`, or null when either is
 * missing or malformed. Two passes settle a daylight-saving offset; the Gulf has none.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const wall = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(wall.getTime())) return null;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  const offset = (at: Date) => {
    const part = (type: string) => Number(format.formatToParts(at).find((p) => p.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute')) - at.getTime();
  };
  const first = new Date(wall.getTime() - offset(wall));
  return new Date(wall.getTime() - offset(first));
}

/** What the dialog says before posting: an interviewer and a future time are required ("Validation" scenario). */
export function scheduleProblem(at: Date | null, interviewerUserId: string, now: Date): ScheduleError | null {
  if (!interviewerUserId) return 'noInterviewer';
  if (!at || at <= now) return 'pastTime';
  return null;
}

export type ScheduleView = {
  interviewers: InterviewerOption[];
  /** The interview the dialog is open for; null while closed. */
  row: InterviewRow | null;
  onOpen: (row: InterviewRow) => void;
  onClose: () => void;
  date: string;
  onDateChange: (date: string) => void;
  time: string;
  onTimeChange: (time: string) => void;
  timeZone: string;
  interviewerUserId: string;
  onInterviewerChange: (userId: string) => void;
  error: ScheduleError | null;
  /** ISO time of the interviewer's other interview, while the clash warning shows. */
  clashAt: string | null;
  pending: boolean;
  /** Posts the dialog; `keepClash` after the person chose "Keep this time". */
  onSave: (keepClash?: boolean) => Promise<void>;
  /** A schedule was saved since the page loaded: the success line shows. */
  done: boolean;
};
