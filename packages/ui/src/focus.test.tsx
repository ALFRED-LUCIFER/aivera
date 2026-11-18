import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { resolveColour, stylesCss, tokens } from '../test/theme.ts';
import { Button } from './Button.tsx';
import { Checkbox } from './Checkbox.tsx';
import { Input, Label, Select } from './Field.tsx';
import { SegmentedControl } from './RadioGroup.tsx';

// jsdom cannot paint :focus-visible, so this proves the keyboard path and that every stop gets the ring:
// the global rule in styles.css, no control switching it off, and the segment drawing it for its hidden radio.
// The painted ring is checked in a browser in light and dark (PR notes).
// SAFETY: mutation check: outline-offset 2px -> 1px in styles.css -> failed; dropped has-focus-visible:outline-2 -> failed
describe('Scenario: Every control shows the focus ring', () => {
  it('Tab visits Button, Input, Select, Checkbox and SegmentedControl, each with the 2px --focus ring offset 2px', async () => {
    render(
      <form>
        <Button>Save draft</Button>
        <Label htmlFor="job">Job title</Label>
        <Input id="job" />
        <Label htmlFor="stage">Stage</Label>
        <Select id="stage">
          <option>Round 1</option>
        </Select>
        <Checkbox label="Mandatory" />
        <SegmentedControl
          legend="Shown in evidence"
          options={[
            { value: 'not', label: 'Not shown' },
            { value: 'partly', label: 'Partly shown' },
          ]}
        />
      </form>,
    );
    const stops = [
      screen.getByRole('button', { name: 'Save draft' }),
      screen.getByLabelText('Job title'),
      screen.getByLabelText('Stage'),
      screen.getByRole('checkbox', { name: 'Mandatory' }),
      screen.getByRole('radio', { name: 'Not shown' }),
    ];
    for (const stop of stops) {
      await userEvent.tab();
      expect(document.activeElement).toBe(stop);
      expect(stop.className).not.toMatch(/outline-(none|hidden|0)\b/);
    }

    expect(stylesCss).toMatch(/:focus-visible\s*{\s*outline:\s*2px solid var\(--focus\);\s*outline-offset:\s*2px;/);
    const segment = stops[4]?.closest('label')?.className.split(' ');
    expect(segment).toEqual(
      expect.arrayContaining([
        'has-focus-visible:outline-2',
        'has-focus-visible:outline-offset-2',
        'has-focus-visible:outline-focus',
      ]),
    );
  });

  it('in dark theme the ring uses #FFE873', () => {
    expect(tokens.color.dark['focus']).toBe('#FFE873');
    expect(resolveColour('outline-focus', 'dark')).toBe('#FFE873');
  });
});
