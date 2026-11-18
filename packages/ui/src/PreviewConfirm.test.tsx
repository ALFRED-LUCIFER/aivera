import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { contrast, resolveColour, type Theme } from '../test/theme.ts';
import { AssistantDrawer } from './AssistantDrawer.tsx';
import { Button } from './Button.tsx';
import { Checkbox } from './Checkbox.tsx';
import { PreviewBanner, PreviewConfirmCard, SuccessBanner, type PreviewConfirmProps } from './PreviewConfirm.tsx';

const labels = {
  confirmLabel: 'Confirm move',
  pendingLabel: 'Moving…',
  editLabel: 'Edit',
  cancelLabel: 'Cancel',
  footer: 'Nothing changes until you confirm.',
  errorMessage: 'That did not go through. Nothing was changed.',
};

function MoveSara(props: Partial<PreviewConfirmProps>) {
  const [open, setOpen] = useState(false);
  return (
    <PreviewConfirmCard
      {...labels}
      title="Preview: move Sara Al Qahtani to Round 2"
      consequence="Sara gets an interview invitation for Round 2."
      closeLabel="Close"
      trigger={<Button>Move to Round 2</Button>}
      open={open}
      onOpenChange={setOpen}
      onConfirm={() => {}}
      onEdit={() => {}}
      onCancel={() => {}}
      {...props}
    >
      <dl>
        <dt>Current</dt>
        <dd>Round 1 complete</dd>
        <dt>Proposed</dt>
        <dd>Round 2 interview</dd>
      </dl>
    </PreviewConfirmCard>
  );
}

async function openPreview(props: Partial<PreviewConfirmProps> = {}) {
  render(<MoveSara {...props} />);
  const trigger = screen.getByRole('button', { name: 'Move to Round 2' });
  await userEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Preview: move Sara Al Qahtani to Round 2' }) };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PreviewConfirmCard', () => {
  it('Scenario: The preview shows the change and waits', async () => {
    const onConfirm = vi.fn();
    const { dialog } = await openPreview({ onConfirm });
    for (const text of ['Round 1 complete', 'Round 2 interview', 'Nothing changes until you confirm.']) {
      expect(dialog.textContent).toContain(text);
    }
    for (const name of ['Confirm move', 'Edit', 'Cancel']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped onOpenAutoFocus -> this test failed (focus went to Confirm move)
  it('opens with focus on Cancel, never on Confirm', async () => {
    await openPreview();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('Scenario: Only Confirm applies the change, once', async () => {
    const run = deferred();
    const onConfirm = vi.fn(() => run.promise);
    await openPreview({ onConfirm });
    const confirm = screen.getByRole('button', { name: 'Confirm move' });
    // Two clicks in the same tick: React has not re-rendered the disabled button between them.
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm.textContent).toBe('Moving…');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    await act(async () => run.resolve());
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // still cannot be sent twice after success
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Scenario: Cancel changes nothing', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { trigger } = await openPreview({ onConfirm, onCancel });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('Edit emits onEdit only', async () => {
    const onConfirm = vi.fn();
    const onEdit = vi.fn();
    await openPreview({ onConfirm, onEdit });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed busy.current = false in the catch -> this test failed (Confirm stayed disabled)
  it('Scenario: A failed confirm keeps the preview open', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    await openPreview({ onConfirm });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    expect(screen.getByRole('alert').textContent).toBe('That did not go through. Nothing was changed.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm move' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Scenario: Keyboard and screen readers (dialog): Tab reaches Confirm, Escape cancels', async () => {
    const onCancel = vi.fn();
    const { trigger } = await openPreview({ onCancel });
    await userEvent.tab({ shift: true });
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm move' }));
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  // SAFETY: mutation check: removed the pending check in requestClose -> this test failed (dialog closed)
  it('does not close or cancel while the change is being applied', async () => {
    const onCancel = vi.fn();
    await openPreview({ onCancel, onConfirm: () => new Promise(() => {}) });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

function Bulk(props: Partial<PreviewConfirmProps>) {
  return (
    <PreviewBanner
      {...labels}
      confirmLabel="Send 3 requests"
      pendingLabel="Sending…"
      title="Preview: evidence request to 3 people"
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    >
      <p>Not sent yet</p>
      <Checkbox label="Send a follow-up after 5 days" />
    </PreviewBanner>
  );
}

describe('PreviewBanner', () => {
  it('Scenario: Keyboard and screen readers (inline): a labelled region, Confirm by Tab, Escape cancels', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<Bulk onCancel={onCancel} onConfirm={onConfirm} />);
    const region = screen.getByRole('region', { name: 'Preview: evidence request to 3 people' });
    expect(region.textContent).toContain('Not sent yet');
    expect(region.textContent).toContain('Nothing changes until you confirm.');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull(); // no onEdit, no Edit
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send 3 requests' }));
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms once and announces success with a SuccessBanner', async () => {
    const onConfirm = vi.fn();
    render(<Bulk onConfirm={onConfirm} />);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Send 3 requests' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    render(<SuccessBanner>3 evidence requests sent.</SuccessBanner>);
    expect(screen.getByRole('status').textContent).toBe('3 evidence requests sent.');
  });
});

function Drawer({ onAsk = () => {} }: { onAsk?: (q: string) => void }) {
  return (
    <>
      <p>Ranking for Senior AI Engineer</p>
      <AssistantDrawer
        title="Aivera assistant"
        context="Context: Senior AI Engineer, 64 candidates"
        inputLabel="Ask about what is on this page"
        askLabel="Ask"
        footer="Answers cite the evidence they use. Any change is shown as a preview and waits for your confirmation."
        closeLabel="Close assistant"
        onAsk={onAsk}
        trigger={<Button>Ask Aivera</Button>}
      >
        <Button>Who has the strongest evidence for evaluation?</Button>
      </AssistantDrawer>
    </>
  );
}

describe('AssistantDrawer', () => {
  it('Scenario: The assistant drawer frame', async () => {
    render(<Drawer />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask Aivera' }));
    const drawer = screen.getByRole('dialog', { name: 'Aivera assistant' });
    expect(screen.getByText('Context: Senior AI Engineer, 64 candidates').id).toBe(
      drawer.getAttribute('aria-describedby'),
    );
    expect(screen.getByRole('textbox', { name: 'Ask about what is on this page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(drawer.textContent).toContain(
      'Answers cite the evidence they use. Any change is shown as a preview and waits for your confirmation.',
    );
    expect(drawer.textContent).toContain('Who has the strongest evidence for evaluation?');
  });

  // SAFETY: mutation check: modal={false} -> modal -> this test failed (page hidden from assistive tech)
  // SAFETY: mutation check: removed onInteractOutside preventDefault -> this test failed (page click closed it)
  it('is non-modal: the page stays available, Escape closes and focus returns to the opener', async () => {
    render(<Drawer />);
    const trigger = screen.getByRole('button', { name: 'Ask Aivera' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull();
    expect(screen.getByText('Ranking for Senior AI Engineer').closest('[aria-hidden="true"]')).toBeNull();
    await userEvent.click(screen.getByText('Ranking for Senior AI Engineer'));
    expect(screen.getByRole('dialog')).toBeTruthy(); // working on the page does not dismiss it
    screen.getByRole('textbox').focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('sends the trimmed question and ignores an empty one', async () => {
    const onAsk = vi.fn();
    render(<Drawer onAsk={onAsk} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask Aivera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onAsk).not.toHaveBeenCalled();
    const input = screen.getByRole('textbox', { name: 'Ask about what is on this page' });
    await userEvent.type(input, '  Why is Sara ranked first?  {Enter}');
    expect(onAsk).toHaveBeenCalledWith('Why is Sara ranked first?');
    expect((input as HTMLInputElement).value).toBe('');
  });
});

// The error and success banners carry meaning in colour (with an icon and words), so their text must read.
describe.each<Theme>(['light', 'dark'])('banner contrast in %s', (theme) => {
  it.each([
    ['text-err-text', 'bg-err-bg'],
    ['text-ok-text', 'bg-ok-bg'],
  ])('%s on %s is at least 4.5:1', (fg, bg) => {
    const ratio = contrast(resolveColour(fg, theme) ?? '', resolveColour(bg, theme) ?? '');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
