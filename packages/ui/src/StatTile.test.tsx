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

  // SAFETY: mutation check: rendered `{value ?? '0'}` in place of the null branch -> 'no figure reads "Not yet available"…' failed
  it('no figure reads "Not yet available" with its marker, never 0', () => {
    const { container } = render(<StatTile label="AI tokens today" value={null} basis="observed" {...labels} />);
    expect(container.textContent).not.toMatch(/\b0\b/);
    expect(container.textContent).not.toContain('Observed');
    expect(screen.getAllByText('Not yet available')).toHaveLength(2);
  });
});
