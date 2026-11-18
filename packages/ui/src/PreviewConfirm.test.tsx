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

function Reused() {
  const [open, setOpen] = useState(false);
  return (
    <PreviewConfirmCard
      {...labels}
      title="Preview: move Sara Al Qahtani to Round 2"
      closeLabel="Close"
      trigger={<Button>Move to Round 2</Button>}
      open={open}
      onOpenChange={setOpen}
      onConfirm={async () => setOpen(false)}
      onCancel={() => {}}
    />
  );
}

function Programmatic() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Send evidence requests</Button>
      <PreviewConfirmCard
        {...labels}
        title="Preview: evidence request to 3 people"
        closeLabel="Close"
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          screen.getByRole('button', { name: 'Send evidence requests' }).focus();
        }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </>
  );
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

  // SAFETY: mutation check: removed `if (busy.current) return;` -> this test failed (onConfirm called twice)
  it('Scenario: Only Confirm applies the change, once', async () => {
    const run = deferred();
    const onConfirm = vi.fn(() => run.promise);
    await openPreview({ onConfirm });
    const confirm = screen.getByRole('button', { name: 'Confirm move' });
    // Two clicks in the same tick: React has not re-rendered between them, so only the ref guard can stop the second.
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm.textContent).toBe('Moving…');
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    // Stays focusable while pending: disabling the focused button would drop focus to <body>, outside the dialog.
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await act(async () => run.resolve());
    await userEvent.click(confirm); // still cannot be sent twice after success
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

  // SAFETY: mutation check: removed busy.current = false in the catch -> this test failed (retry ignored)
  it('Scenario: A failed confirm keeps the preview open', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    await openPreview({ onConfirm });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    expect(screen.getByRole('alert').textContent).toBe('That did not go through. Nothing was changed.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm move' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(document.activeElement).toBe(confirm); // the person keeps their place
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
  // SAFETY: mutation check: dropped closeDisabled={state.pending} -> this test failed (close button enabled)
  it('does not close or cancel while the change is being applied', async () => {
    const onCancel = vi.fn();
    await openPreview({ onCancel, onConfirm: () => new Promise(() => {}) });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // SAFETY: mutation check: removed the reopen state reset -> this test failed (Cancel disabled on reopen)
  // SAFETY: mutation check: removed rearm() in onOpenAutoFocus -> this test failed (second Confirm ignored)
  it('starts fresh when a reused card opens again after a successful confirm', async () => {
    render(<Reused />);
    const trigger = screen.getByRole('button', { name: 'Move to Round 2' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(trigger);
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    expect(screen.getByRole('button', { name: 'Confirm move' }).getAttribute('aria-busy')).toBeNull();
    expect(cancel.disabled).toBe(false);
    expect(document.activeElement).toBe(cancel);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(trigger); // and a new change can be confirmed: the guard is re-armed
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // SAFETY: mutation check: dropped the onCloseAutoFocus pass-through -> this test failed (focus lost)
  it('returns focus through onCloseAutoFocus when opened without a trigger', async () => {
    render(<Programmatic />);
    const opener = screen.getByRole('button', { name: 'Send evidence requests' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
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

  // SAFETY: mutation check: removed e.stopPropagation() -> this test failed (Escape reached the document)
  it('one Escape cancels the banner and does not reach a layer around it', async () => {
    const onCancel = vi.fn();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    render(<Bulk onCancel={onCancel} />);
    screen.getByRole('button', { name: 'Send 3 requests' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
  });
});

describe('SuccessBanner', () => {
  it('stays mounted as one status region and swaps in the message, so it is announced', () => {
    const { rerender } = render(<SuccessBanner />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    rerender(<SuccessBanner>3 evidence requests sent.</SuccessBanner>);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('3 evidence requests sent.');
    expect(status.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
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

  // SAFETY: mutation check: removed the re-entry onClick -> this test failed (the drawer closed)
  it('pressing the opener again takes focus back into the open drawer instead of closing it', async () => {
    render(<Drawer />);
    const trigger = screen.getByRole('button', { name: 'Ask Aivera' });
    await userEvent.click(trigger);
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ask about what is on this page' }));
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
