import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatTile } from './StatTile.tsx';

afterEach(cleanup);
const labels = { basisLabel: 'Observed', notAvailableLabel: 'Not yet available' };

describe('Scenario: A stat tile always states its basis', () => {
  it('shows the figure and the "Observed" marker', () => {
    render(<StatTile label="Workspaces waiting for approval" value="3" basis="observed" {...labels} />);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Observed')).toBeTruthy();
  });

  it('a failed read says so in words, with neither a figure nor a basis marker', () => {
    const { container } = render(
      <StatTile
        label="AI tokens today"
        value="5"
        basis="observed"
        {...labels}
        error="We could not load AI use. Try again."
      />,
    );
    expect(screen.getByText('We could not load AI use. Try again.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/5|Observed|Not yet available/);
  });

  // SAFETY: mutation check: rendered `{value ?? '0'}` in place of the figure -> 'no figure reads "Not yet available"…' failed
  it('no figure reads "Not yet available" with its marker, never 0', () => {
    const { container } = render(<StatTile label="AI tokens today" value={null} basis="observed" {...labels} />);
    expect(screen.queryByText('0')).toBeNull();
    expect(container.textContent).not.toContain('Observed');
    expect(screen.getByText('Not yet available')).toBeTruthy();
  });
});
