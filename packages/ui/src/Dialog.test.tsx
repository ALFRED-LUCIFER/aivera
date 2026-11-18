import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.tsx';
import { Dialog, DialogClose } from './Dialog.tsx';

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
});
