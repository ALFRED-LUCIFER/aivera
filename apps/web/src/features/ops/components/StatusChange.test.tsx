// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { reasonReady, type StatusChangeView, type WorkspaceRow } from '../domain/workspaces.ts';
import { StatusChange } from './StatusChange.tsx';
import { WorkspaceDetail } from './WorkspaceDetail.tsx';

// AIV-P2-037: the status change card and the operator actions history. Synthetic names (personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const PREVIEW_BODY = 'Members can still read everything. New work, AI calls and emails stop. Nothing is deleted.';

function Card({
  onConfirm,
  change = 'suspend',
}: {
  onConfirm: () => Promise<void>;
  change?: StatusChangeView['change'];
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <IntlProvider {...intl}>
      <StatusChange
        name="Gulf Talent Partners"
        change={change}
        open={open}
        onOpenChange={setOpen}
        reason={reason}
        onReasonChange={setReason}
        needsReason={change !== 'approve'}
        canConfirm={change === 'approve' || reasonReady(reason)}
        onConfirm={onConfirm}
        done={null}
      />
    </IntlProvider>
  );
}

describe('Scenario: Suspending needs a reason and a confirmation', () => {
  it('shows the preview, and Confirm stays disabled until the reason has at least 10 characters', async () => {
    const onConfirm = vi.fn(async () => {});
    render(<Card onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Suspend workspace Gulf Talent Partners' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspend Gulf Talent Partners?' });
    expect(dialog.textContent).toContain(PREVIEW_BODY);
    expect(dialog.textContent).toContain('Nothing changes until you confirm.');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    const reason = within(dialog).getByRole('textbox', { name: 'Reason' });
    await userEvent.type(reason, '  123456789 ');
    expect(confirm.disabled).toBe(true);
    await userEvent.type(reason, '0');
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('Reactivate uses the same card with its own words', async () => {
    render(<Card onConfirm={async () => {}} change="reactivate" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate Gulf Talent Partners' }));
    expect(screen.getByRole('dialog', { name: 'Reactivate Gulf Talent Partners?' })).toBeTruthy();
  });
});

describe('Scenario: A suspension is applied and audited', () => {
  const workspace: WorkspaceRow = {
    id: '0190d4a2-0000-7000-8000-0000000000b2',
    name: 'Gulf Talent Partners',
    type: 'agency',
    createdAt: new Date('2026-11-18T23:30:00Z'),
    synthetic: true,
    status: 'suspended',
    activeMembers: 4,
    jobs: 2,
    ai: null,
  };

  it('shows status "Suspended" with its icon and word, and the action with its time and reason', () => {
    render(
      <IntlProvider {...intl}>
        <WorkspaceDetail
          workspace={workspace}
          history={[
            {
              action: 'workspace.suspended',
              occurredAt: new Date('2026-11-19T05:30:00Z'),
              reason: 'Pilot ended on 30 Nov 2026',
            },
          ]}
        />
      </IntlProvider>,
    );
    const status = screen.getAllByRole('term').find((t) => t.textContent === 'Status')?.nextElementSibling;
    expect(status?.textContent).toBe('Suspended');
    expect(status?.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe(
      'Suspended on 19 Nov 2026 at 09:30 (Asia/Dubai): Pilot ended on 30 Nov 2026',
    );
  });
});
