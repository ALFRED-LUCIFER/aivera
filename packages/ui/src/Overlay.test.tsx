import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { Card, Skeleton } from './Card.tsx';
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
  it('appears on keyboard focus and hides on Escape', async () => {
    render(
      <Tooltip content="Backed by 7 of 9 sources">
        <Button>Score</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect((await screen.findByRole('tooltip')).textContent).toBe('Backed by 7 of 9 sources');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('Card', () => {
  // SAFETY: mutation check: Card ignored loading -> failed
  it('Scenario: Loading uses a skeleton, not a spinner over content', () => {
    render(
      <Card title="Evidence" loading loadingLabel="Loading evidence">
        <p>Commit range</p>
      </Card>,
    );
    expect(screen.queryByText('Commit range')).toBeNull();
    const skeleton = screen.getByText('Loading evidence').parentElement;
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(skeleton?.className).toContain('motion-reduce:animate-none');
    expect(screen.getByRole('heading', { name: 'Evidence' })).toBeTruthy();
  });

  it('shows its body when loaded', () => {
    render(
      <Card title="Evidence">
        <p>Commit range</p>
      </Card>,
    );
    expect(screen.getByText('Commit range')).toBeTruthy();
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('a Skeleton alone is busy', () => {
    render(<Skeleton className="h-4" />);
    expect(document.querySelector('[aria-busy="true"]')?.className).toContain('h-4');
  });
});
