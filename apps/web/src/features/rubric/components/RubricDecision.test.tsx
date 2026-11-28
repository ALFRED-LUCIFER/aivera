// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReviewView, RubricDecisionView } from '../domain/rubric.ts';
import { RubricDecision } from './RubricDecision.tsx';

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const review: ReviewView = {
  versionId: 'v2',
  revision: 1,
  version: 2,
  changeNote: 'Product judgement raised from 10% to 15%.',
  approvedVersion: 1,
  successStatement: '',
  competencies: [
    {
      name: 'LLM systems in production',
      evidenceExpected: 'A shipped assistant',
      weightPercent: 100,
      levelNeeded: 4,
      type: 'mandatory',
      origin: 'from_description',
    },
  ],
};
const decision = (more: Partial<RubricDecisionView> = {}): RubricDecisionView => ({
  returning: false,
  note: '',
  pending: false,
  status: 'idle',
  decided: null,
  approving: false,
  onApprovingChange: vi.fn(),
  reason: '',
  onReason: vi.fn(),
  onApprove: vi.fn(async () => {}),
  onStartReturn: vi.fn(),
  onCancelReturn: vi.fn(),
  onNote: vi.fn(),
  onReturn: vi.fn(),
  onSend: vi.fn(),
  ...more,
});
const show = (props: Partial<Parameters<typeof RubricDecision>[0]> = {}) =>
  render(
    <IntlProvider {...intl}>
      <RubricDecision
        review={review}
        decision={decision()}
        outdatedLink={false}
        canReturn
        canSend={false}
        withOwner={false}
        {...props}
      />
    </IntlProvider>,
  );

describe('Scenario: Approve (AIV-P1-014)', () => {
  // SAFETY: mutation check: called decision.onApprove when the preview opens -> this test failed (approved on open)
  it('shows what changed and "Approve rubric", which only opens the preview', async () => {
    const d = decision();
    show({ decision: d });
    expect(screen.getByText('What changed since version 1')).toBeTruthy();
    expect(screen.getByText('Product judgement raised from 10% to 15%.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Approve rubric' }));
    expect(d.onApprovingChange).toHaveBeenCalledWith(true);
    expect(d.onApprove).not.toHaveBeenCalled();
  });

  // AIV-P1-165 "Approving is confirmed and audited": the shared preview-confirm card.
  it('the preview shows the version, its competencies and a reason field; Confirm waits for the reason', async () => {
    const d = decision({ approving: true });
    show({ decision: d });
    const card = screen.getByRole('dialog', { name: 'Preview: approve rubric version 2' });
    expect(card.textContent).toContain('LLM systems in production');
    expect(card.textContent).toContain('100% · Level 4 of 5 · Mandatory');
    expect(card.textContent).toContain('Nothing changes until you confirm.');
    expect(screen.getByRole('button', { name: 'Confirm approval' }).hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason, recorded in the audit log' }), 'M');
    expect(d.onReason).toHaveBeenCalledWith('M');
    expect(d.onApprove).not.toHaveBeenCalled();
  });

  it('only Confirm approves; Cancel closes the preview and approves nothing', async () => {
    const d = decision({ approving: true, reason: 'Matches the job description' });
    show({ decision: d });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(d.onApprovingChange).toHaveBeenCalledWith(false);
    expect(d.onApprove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(d.onApprove).toHaveBeenCalledOnce();
  });

  // AIV-P1-165 "No empty success box".
  it('before any decision the status region is empty and draws no box', () => {
    show();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    expect(status.className).toBe('');
  });

  it('after approving, says assessment has started', () => {
    show({ review: null, decision: decision({ status: 'approved', decided: { version: 2, inForce: true } }) });
    expect(screen.getByRole('status').textContent).toBe(
      'Version 2 is approved. Assessment can now start for this job.',
    );
  });
});

describe('Scenario: Return with a note', () => {
  it('"Return version 2" stays disabled until a note is written', () => {
    show({ decision: decision({ returning: true, note: ' ' }) });
    expect(screen.getByRole('button', { name: 'Return version 2' }).hasAttribute('disabled')).toBe(true);
    cleanup();
    const d = decision({ returning: true, note: 'Arabic NLP should be desirable' });
    show({ decision: d });
    expect(screen.getByRole('textbox', { name: 'Note for the recruiter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return version 2' }).hasAttribute('disabled')).toBe(false);
  });
});

describe('Scenario: Approving an outdated version is refused', () => {
  it('an outdated link says "A newer version is waiting for you" above the newer copy\'s changes', () => {
    show({ outdatedLink: true });
    expect(screen.getByText('A newer version is waiting for you')).toBeTruthy();
  });

  it('a decision on a copy that changed meanwhile is refused with a reload message', () => {
    show({ decision: decision({ status: 'stale' }) });
    expect(screen.getByRole('alert').textContent).toBe(
      'This version changed since you opened it. Reload to see the latest.',
    );
  });

  it.each([
    ['saveFailed', 'We could not save your changes. Try again.'],
    ['saveForbidden', 'You do not have access to do this.'],
  ] as const)('a decision that threw (%s) says "%s" and keeps the panel', (status, text) => {
    show({ decision: decision({ status }) });
    expect(screen.getByRole('alert').textContent).toBe(text);
    expect(screen.getByRole('button', { name: 'Approve rubric' })).toBeTruthy();
  });
});

describe('Scenario: A recruiter approves their own draft (ADR-014)', () => {
  it('offers "Approve rubric" and no "Return with a note", with no on-behalf note', async () => {
    const d = decision();
    show({ decision: d, canReturn: false });
    expect(screen.getByText('Version 2 is ready for you to approve')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Return with a note' })).toBeNull();
    expect(screen.queryByText(/on their behalf/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve rubric' })).toBeTruthy();
  });

  it('a version sent to the hiring owner can be returned by them', () => {
    show();
    expect(screen.getByRole('button', { name: 'Return with a note' })).toBeTruthy();
  });

  it('a draft of a job with a hiring owner offers "Send to the hiring owner", which only the recruiter triggers', async () => {
    const d = decision();
    show({ decision: d, canReturn: false, canSend: true });
    await userEvent.click(screen.getByRole('button', { name: 'Send to the hiring owner' }));
    expect(d.onSend).toHaveBeenCalledOnce();
    expect(d.onApprove).not.toHaveBeenCalled();
  });

  it('a version the recruiter sent is "with the hiring owner", still approvable by them, not returnable', () => {
    show({ canReturn: false, withOwner: true });
    expect(screen.getByText('Version 2 is with the hiring owner')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve rubric' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Return with a note' })).toBeNull();
  });

  it('after sending, says the hiring owner has it', () => {
    show({ decision: decision({ status: 'sent' }), canReturn: false });
    expect(screen.getByRole('status').textContent).toBe(
      'Sent to the hiring owner. They can approve it or return it with a note. You can still approve it yourself.',
    );
  });
});
