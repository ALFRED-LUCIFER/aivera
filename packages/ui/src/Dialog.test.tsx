import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { Dialog, DialogClose } from './Dialog.tsx';
import { Input } from './Field.tsx';

function EditRubric() {
  return (
    <Dialog
      title="Edit rubric"
      description="Nothing changes until you confirm."
      closeLabel="Close"
      trigger={<Button>Edit rubric</Button>}
    >
      <DialogClose asChild>
        <Button>Cancel</Button>
      </DialogClose>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('opens from its trigger, takes focus, and returns it on Escape', async () => {
    render(<EditRubric />);
    const trigger = screen.getByRole('button', { name: 'Edit rubric' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Edit rubric' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByText('Nothing changes until you confirm.').id).toBe(dialog.getAttribute('aria-describedby'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes from its labelled close button and from a DialogClose', async () => {
    render(<EditRubric />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit rubric' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit rubric' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Every element that moves has its transition switched off under prefers-reduced-motion (motion-reduce:).
  // SAFETY: mutation check: removed motion-reduce:transition-none from the dialog content -> failed
  it('Scenario: Reduced motion turns transitions off', async () => {
    render(<EditRubric />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit rubric' }));
    const moving = [...document.body.querySelectorAll<HTMLElement>('[class*="transition"], [class*="animate-"]')];
    expect(moving.length).toBeGreaterThanOrEqual(3); // overlay, content, close button
    for (const el of moving) {
      const classes = el.className.split(' ');
      if (classes.some((c) => c.startsWith('transition'))) expect(classes).toContain('motion-reduce:transition-none');
      if (classes.some((c) => c.startsWith('animate-'))) expect(classes).toContain('motion-reduce:animate-none');
      expect(classes.filter((c) => c.startsWith('duration-'))).toEqual(['duration-120']);
    }
  });

  it('scrolls tall content inside a panel capped at the viewport', async () => {
    render(<EditRubric />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit rubric' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className.split(' ')).toEqual(expect.arrayContaining(['max-h-full', 'overflow-y-auto']));
    expect(dialog.parentElement?.className.split(' ')).toEqual(expect.arrayContaining(['fixed', 'inset-4']));
  });

  // SAFETY: mutation check: dropped the onOpenAutoFocus pass-through -> failed (focus went to the Note input)
  it('lets a screen choose initial focus, focus return and Escape handling', async () => {
    const onEscapeKeyDown = vi.fn();
    const onCloseAutoFocus = vi.fn();
    render(
      <>
        <Button>Back to list</Button>
        <Dialog
          defaultOpen
          title="Withdraw request"
          closeLabel="Close"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            screen.getByRole('button', { name: 'Keep request' }).focus();
          }}
          onEscapeKeyDown={onEscapeKeyDown}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onCloseAutoFocus();
          }}
        >
          <Input aria-label="Note" />
          <Button>Keep request</Button>
        </Dialog>
      </>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep request' }));
    await userEvent.keyboard('{Escape}');
    expect(onEscapeKeyDown).toHaveBeenCalled();
    expect(onCloseAutoFocus).toHaveBeenCalled();
  });
});
