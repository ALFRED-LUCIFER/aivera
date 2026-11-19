import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { contrast, resolveColour } from '../test/theme.ts';
import { LevelMeter } from './LevelMeter.tsx';

const segments = (c: HTMLElement) => [...c.querySelectorAll('[aria-hidden="true"] > span')];

describe('LevelMeter', () => {
  // Mutation check: i <= level -> i < level -> every row failed.
  it.each([1, 4, 5])('level %i fills that many of five segments and reads its words', (level) => {
    const { container } = render(<LevelMeter level={level} label={`${level} of 5`} />);
    expect(screen.getByText(`${level} of 5`)).toBeTruthy();
    expect(segments(container)).toHaveLength(5);
    expect(segments(container).filter((s) => s.classList.contains('bg-text-2'))).toHaveLength(level);
  });

  it.each(['light', 'dark'] as const)('%s: a filled segment keeps at least 3:1 on the surface', (theme) => {
    expect(
      contrast(resolveColour('bg-text-2', theme) ?? '', resolveColour('bg-surface', theme) ?? ''),
    ).toBeGreaterThanOrEqual(3);
  });
});
