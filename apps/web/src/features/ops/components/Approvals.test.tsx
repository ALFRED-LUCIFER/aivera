// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { reasonReady } from '../domain/workspaces.ts';
import { ApprovalMode } from './ApprovalMode.tsx';
import { ApprovalsList } from './ApprovalsList.tsx';

// AIV-P2-039: the approvals page's list and the approval switch. Synthetic names (personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});
const show = (node: ReactNode) => render(<IntlProvider {...intl}>{node}</IntlProvider>);

const nadia = {
  id: '0190d4a2-0000-7000-8000-0000000000c1',
  name: 'Nadia Freelance',
  type: 'in_house' as const,
  createdAt: new Date('2026-11-18T23:30:00Z'),
  creatorEmail: 'nadia@example.com',
  waitingDays: 1,
  decide: <button type="button">Approve</button>,
};

describe('Scenario: The operator approves (the list)', () => {
  it('lists the workspace with type "In-house team", the created date and the creator\'s email', () => {
    show(<ApprovalsList rows={[nadia]} />);
    const table = screen.getByRole('table', { name: 'Workspaces waiting for approval' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Workspace', 'Type', 'Created (Asia/Dubai)', 'Waiting', 'Creator', 'Decision']);
    expect(
      within(table)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Nadia Freelance', 'In-house team', '19 Nov 2026', '1 day', 'nadia@example.com', 'Approve']);
  });
});

describe('Scenario: Empty, loading and error', () => {
  it('no workspace pending: "No workspaces are waiting for approval."', () => {
    show(<ApprovalsList rows={[]} />);
    expect(screen.getByText('No workspaces are waiting for approval.')).toBeTruthy();
  });

  it('the request fails: "We could not load approvals. Try again." and a retry', async () => {
    const onRetry = vi.fn();
    show(<ApprovalsList rows={[]} failed={{ onRetry }} />);
    expect(screen.getByRole('alert').textContent).toBe('We could not load approvals. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

function Switch({ required, onConfirm }: { required: boolean; onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <ApprovalMode
      required={required}
      open={open}
      onOpenChange={setOpen}
      reason={reason}
      onReasonChange={setReason}
      canConfirm={reasonReady(reason)}
      onConfirm={onConfirm}
      done={null}
    />
  );
}

describe('Scenario: Changing the switch is audited and approves nothing (the card)', () => {
  it('shows "On", and turning it off says pending workspaces stay pending; Confirm needs a 10-character reason', async () => {
    const onConfirm = vi.fn(async () => {});
    show(<Switch required onConfirm={onConfirm} />);
    expect(screen.getByText('On')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn off approval for new workspaces?' });
    expect(dialog.textContent).toContain('Workspaces already waiting stay waiting until you decide each one.');
    expect(dialog.textContent).toContain('Nothing changes until you confirm.');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Pilot ope');
    expect(confirm.disabled).toBe(true);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'n');
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows "Off" and offers to turn it on', () => {
    show(<Switch required={false} onConfirm={async () => {}} />);
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy();
  });
});
