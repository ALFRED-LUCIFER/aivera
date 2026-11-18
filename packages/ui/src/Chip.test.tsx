import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { contrast, resolveColour, type Theme } from '../test/theme.ts';
import { Chip, StatusBadge, type Status } from './Chip.tsx';

const cases: [Status, string, string][] = [
  ['supported', 'Supported', 'ok'],
  ['needsValidation', 'Needs validation', 'warn'],
  ['contradiction', 'Contradiction', 'err'],
  ['informational', 'Informational', 'info'],
];

describe('Scenario Outline: Status always carries an icon and a word', () => {
  // SAFETY: mutation check: StatusBadge dropped the icon -> every row failed
  it.each(cases)('%s shows an icon and the word "%s"', (status, word) => {
    render(<StatusBadge status={status} label={word} />);
    const badge = screen.getByText(word);
    expect(badge.textContent).toBe(word);
    const icon = badge.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('path')?.getAttribute('d')).toBeTruthy();
  });

  it('each status has its own icon', () => {
    render(
      <>
        {cases.map(([status, word]) => (
          <StatusBadge key={status} status={status} label={word} />
        ))}
      </>,
    );
    const paths = cases.map(([, word]) => screen.getByText(word).querySelector('path')?.getAttribute('d'));
    expect(new Set(paths).size).toBe(4);
  });
});

describe('StatusBadge tokens', () => {
  // SAFETY: mutation check: warn text-warn-text -> text-text-3 -> both themes failed
  const themed = cases.flatMap(([status, word, tone]) =>
    (['light', 'dark'] as const).map((theme): [Status, string, string, Theme] => [status, word, tone, theme]),
  );
  it.each(themed)('%s (%s) uses its own %s tokens with 4.5:1 text in %s', (status, word, tone, theme) => {
    render(<StatusBadge status={status} label={word} />);
    const classes = screen.getByText(word).className.split(' ');
    expect(classes).toEqual(expect.arrayContaining([`bg-${tone}-bg`, `text-${tone}-text`, `border-${tone}-border`]));
    const ratio = contrast(
      resolveColour(`text-${tone}-text`, theme) ?? '',
      resolveColour(`bg-${tone}-bg`, theme) ?? '',
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each<Theme>(['light', 'dark'])('a neutral Chip keeps 4.5:1 text in %s', (theme) => {
    render(<Chip>Applied to 5 roles</Chip>);
    const classes = screen.getByText('Applied to 5 roles').className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['bg-surface-subtle', 'text-text-2', 'rounded-full', 'h-6.5']));
    expect(
      contrast(resolveColour('text-text-2', theme) ?? '', resolveColour('bg-surface-subtle', theme) ?? ''),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
