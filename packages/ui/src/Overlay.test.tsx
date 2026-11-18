import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Toast, ToastProvider } from './Toast.tsx';
import { Tooltip } from './Tooltip.tsx';

describe('Toast', () => {
  it('shows its title and description and closes from its labelled button', async () => {
    const onOpenChange = vi.fn();
    render(
      <ToastProvider toastLabel="Notification" regionLabel="Notifications">
        <Toast
          open
          title="Rubric approved"
          description="Ranking will refresh."
          closeLabel="Dismiss"
          onOpenChange={onOpenChange}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getAllByText('Rubric approved').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Tooltip', () => {
  it('repeats visible text on keyboard focus and hides on Escape', async () => {
    render(
      <Tooltip content="Copy link">
        <Button>Copy link</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect((await screen.findByRole('tooltip')).textContent).toBe('Copy link');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('Card', () => {
  // SAFETY: mutation check: Card ignored loading -> failed; moved aria-busy off the body region -> failed
  it('Scenario: Loading uses a skeleton, not a spinner over content', () => {
    render(
      <Card title="Evidence" loading loadingLabel="Loading evidence">
        <p>Commit range</p>
      </Card>,
    );
    expect(screen.queryByText('Commit range')).toBeNull();
    const body = document.querySelector('[aria-busy="true"]');
    const skeleton = body?.firstElementChild;
    expect(skeleton?.className).toContain('animate-pulse');
    expect(skeleton?.className).toContain('motion-reduce:animate-none');
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Loading evidence');
    expect(body?.contains(status)).toBe(false); // a label inside a busy region may never be read
    expect(screen.getByRole('heading', { level: 3, name: 'Evidence' })).toBeTruthy();
  });

  it('shows its body when loaded and empties the status', () => {
    render(
      <Card title="Evidence" level={2} loadingLabel="Loading evidence">
        <p>Commit range</p>
      </Card>,
    );
    expect(screen.getByText('Commit range')).toBeTruthy();
    expect(document.querySelector('[aria-busy]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('heading', { level: 2, name: 'Evidence' })).toBeTruthy();
  });
});
