import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { contrast, resolveColour, type Theme } from '../test/theme.ts';
import { RadioGroup, SegmentedControl, type ChoiceOption } from './RadioGroup.tsx';

const shown: ChoiceOption[] = [
  { value: 'not', label: 'Not shown' },
  { value: 'partly', label: 'Partly shown' },
  { value: 'clearly', label: 'Clearly shown' },
  { value: 'strongly', label: 'Strongly shown' },
];

function Controlled() {
  const [value, setValue] = useState('partly');
  return <SegmentedControl legend="Shown in evidence" options={shown} value={value} onValueChange={setValue} />;
}

describe('SegmentedControl', () => {
  // SAFETY: mutation check: type="radio" -> type="checkbox" -> failed (no radio role, no arrow-key walk)
  it('Scenario: The segmented control works by keyboard', async () => {
    const onValueChange = vi.fn();
    render(<SegmentedControl legend="Shown in evidence" options={shown} onValueChange={onValueChange} />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}{ArrowRight} ');
    const clearly = screen.getByRole('radio', { name: 'Clearly shown' });
    expect(clearly).toHaveProperty('checked', true);
    expect(document.activeElement).toBe(clearly);
    expect(screen.getByRole('radiogroup', { name: 'Shown in evidence' })).toBeTruthy();
    expect(onValueChange).toHaveBeenLastCalledWith('clearly');
  });

  it('is controlled when given a value', async () => {
    render(<Controlled />);
    expect(screen.getByRole('radio', { name: 'Partly shown' })).toHaveProperty('checked', true);
    await userEvent.click(screen.getByText('Strongly shown'));
    expect(screen.getByRole('radio', { name: 'Strongly shown' })).toHaveProperty('checked', true);
  });

  it('a controlled value the parent does not change stays put', async () => {
    render(<SegmentedControl legend="Shown in evidence" options={shown} value="not" />);
    await userEvent.click(screen.getByText('Clearly shown'));
    expect(screen.getByRole('radio', { name: 'Not shown' })).toHaveProperty('checked', true);
  });
});

const segmentClasses = (name: string) =>
  screen.getByRole('radio', { name }).closest('label')?.className.split(' ') ?? [];

describe('SegmentedControl size and disabled state', () => {
  // SAFETY: mutation check: min-h-10 -> h-8 -> failed
  it('each segment is 40px and 44px on a coarse pointer (AGENTS.md §4)', () => {
    render(<SegmentedControl legend="Shown in evidence" options={shown} />);
    expect(segmentClasses('Not shown')).toEqual(expect.arrayContaining(['min-h-10', 'pointer-coarse:min-h-11']));
    expect(segmentClasses('Not shown').some((c) => /^h-\d/.test(c))).toBe(false);
  });

  // A submitted scorecard: the chosen answer stays readable when the group is disabled.
  // SAFETY: mutation check: removed the has-checked:has-disabled classes -> failed; their ground bg-surface -> bg-action -> failed
  it.each<Theme>(['light', 'dark'])('a checked segment of a disabled group keeps 4.5:1 in %s', (theme) => {
    render(<SegmentedControl legend="Shown in evidence" options={shown} value="clearly" disabled />);
    const classes = segmentClasses('Clearly shown');
    const pick = (prefix: string) =>
      classes.find((c) => c.startsWith(`has-checked:has-disabled:${prefix}`))?.replace('has-checked:has-disabled:', '');
    const text = pick('text-');
    const ground = pick('bg-');
    expect(text && ground).toBeTruthy();
    const ratio = contrast(resolveColour(text ?? '', theme) ?? '', resolveColour(ground ?? '', theme) ?? '');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe('RadioGroup', () => {
  it('passes required, aria-invalid and aria-describedby through', () => {
    render(<RadioGroup legend="Weight" options={shown} required aria-invalid aria-describedby="weight-error" />);
    const group = screen.getByRole('radiogroup', { name: 'Weight' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toBe('weight-error');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveProperty('required', true);
  });

  it('is uncontrolled with a default value and names the group by its legend', async () => {
    render(<RadioGroup legend="Weight" options={shown} defaultValue="strongly" />);
    expect(screen.getByRole('radiogroup', { name: 'Weight' }).tagName).toBe('FIELDSET');
    expect(screen.getByRole('radio', { name: 'Strongly shown' })).toHaveProperty('checked', true);
    await userEvent.click(screen.getByRole('radio', { name: 'Not shown' }));
    expect(screen.getByRole('radio', { name: 'Not shown' })).toHaveProperty('checked', true);
  });

  it('disables every option when disabled', async () => {
    render(<RadioGroup legend="Weight" options={shown} disabled />);
    await userEvent.click(screen.getByText('Partly shown'));
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.matches(':disabled')).toBe(true);
      expect(radio).toHaveProperty('checked', false);
    }
  });
});
