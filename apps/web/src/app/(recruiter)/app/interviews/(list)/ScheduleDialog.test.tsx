// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InterviewRow } from '@/features/interviews/domain/interviews.ts';
import type { ScheduleResult } from '@/features/interviews/domain/schedule.ts';
import { useScheduleController } from '@/features/interviews/hooks/useScheduleController.ts';
import { InterviewsList } from '@/features/interviews/components/InterviewsList.tsx';

// AIV-P2-007: the Schedule dialog with its controller, the action faked. Synthetic cast only (personas.md).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const daniel: InterviewRow = {
  id: '0190d4a2-0000-7000-9000-000000000060',
  candidate: 'Daniel Novak',
  job: 'Senior AI Engineer',
  round: 'structured_screen',
  interviewer: null,
  interviewerUserId: '',
  scheduledAt: null,
  today: false,
  status: 'to_schedule',
  dueDays: null,
  competencies: ['Retrieval and evaluation'],
};

function Harness({ schedule }: { schedule: (input: unknown) => Promise<ScheduleResult> }) {
  const view = useScheduleController([{ value: LINA, label: 'Lina Haddad' }], { scheduleInterview: schedule });
  return (
    <InterviewsList
      view={{
        status: 'ready',
        view: 'ongoing',
        onViewChange: () => {},
        rows: [daniel],
        counts: { ongoing: 1, completed: 0 },
        people: 0,
        jobs: 0,
        schedule: view,
        start: { pending: false, onStart: () => {} },
      }}
    />
  );
}

const show = (schedule: (input: unknown) => Promise<ScheduleResult>) =>
  render(
    <IntlProvider {...intl}>
      <Harness schedule={schedule} />
    </IntlProvider>,
  );

describe('Schedule dialog', () => {
  it('asks for an interviewer, then a future time, before posting anything', async () => {
    const schedule = vi.fn(async (): Promise<ScheduleResult> => ({ ok: true }));
    show(schedule);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule Daniel Novak' }));
    const dialog = screen.getByRole('dialog', { name: 'Schedule Round 1' });
    expect(within(dialog).getByText('Nobody is contacted.', { exact: false })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Choose an interviewer');
    await userEvent.selectOptions(within(dialog).getByLabelText('Interviewer'), LINA);
    await userEvent.type(within(dialog).getByLabelText('Date'), '2020-01-01');
    await userEvent.type(within(dialog).getByLabelText('Time (Asia/Dubai)'), '11:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Choose a future time');
    expect(schedule).not.toHaveBeenCalled();
  });

  it('warns of a clash and keeps the time when asked, then says nobody was contacted', async () => {
    const schedule = vi
      .fn<(input: unknown) => Promise<ScheduleResult>>()
      .mockResolvedValueOnce({ ok: false, error: 'clash', clashAt: '2099-11-21T07:00:00.000Z' })
      .mockResolvedValueOnce({ ok: true });
    show(schedule);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule Daniel Novak' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Interviewer'), LINA);
    await userEvent.type(within(dialog).getByLabelText('Date'), '2099-11-21');
    await userEvent.type(within(dialog).getByLabelText('Time (Asia/Dubai)'), '11:30');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'The interviewer already has an interview at this time (21 Nov, 11:00)',
    );
    expect(schedule).toHaveBeenLastCalledWith({
      interviewId: daniel.id,
      scheduledAt: '2099-11-21T07:30:00.000Z',
      interviewerUserId: LINA,
      keepClash: false,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep this time' }));
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ keepClash: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Scheduled. Nobody has been contacted.')).toBeTruthy();
  });
});
