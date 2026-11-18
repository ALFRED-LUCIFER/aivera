import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './Checkbox.tsx';
import { Input, Label, Select, Textarea } from './Field.tsx';

function UpperCaseInput() {
  const [value, setValue] = useState('');
  return <Input aria-label="Search" value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} />;
}

describe('Input and Label', () => {
  it('is a real input named by its label, 40px and 44px on a coarse pointer', async () => {
    render(
      <>
        <Label htmlFor="title">Job title</Label>
        <Input id="title" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Job title' });
    expect(input.className.split(' ')).toEqual(expect.arrayContaining(['h-10', 'pointer-coarse:min-h-11']));
    await userEvent.type(input, 'Platform engineer');
    expect(input).toHaveProperty('value', 'Platform engineer');
  });

  it('is controlled when given a value', async () => {
    render(<UpperCaseInput />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'ab');
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveProperty('value', 'AB');
  });

  it('marks an invalid value for assistive technology and draws it in the error token', () => {
    render(<Input aria-label="Email" aria-invalid />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('aria-invalid:border-err-text');
  });

  it('a disabled input cannot be edited', async () => {
    render(<Input aria-label="Locked" disabled defaultValue="Fixed" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Locked' }), 'x');
    expect(screen.getByRole('textbox', { name: 'Locked' })).toHaveProperty('value', 'Fixed');
  });
});

describe('Textarea', () => {
  it('is a real multi-line textbox', async () => {
    render(<Textarea aria-label="Reason" />);
    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.tagName).toBe('TEXTAREA');
    await userEvent.type(textarea, 'Line one{Enter}Line two');
    expect(textarea).toHaveProperty('value', 'Line one\nLine two');
  });
});

describe('Select', () => {
  it('is a native select chosen by keyboard', async () => {
    render(
      <Select aria-label="Stage" defaultValue="r1">
        <option value="r1">Round 1</option>
        <option value="r2">Round 2</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Stage' });
    await userEvent.selectOptions(select, 'Round 2');
    expect(select).toHaveProperty('value', 'r2');
    expect(select.className).toContain('pointer-coarse:min-h-11');
  });
});

describe('Checkbox', () => {
  it('toggles from its label and from Space, controlled or not', async () => {
    render(<Checkbox label="Mandatory" />);
    const box = screen.getByRole('checkbox', { name: 'Mandatory' });
    await userEvent.click(screen.getByText('Mandatory'));
    expect(box).toHaveProperty('checked', true);
    box.focus();
    await userEvent.keyboard(' ');
    expect(box).toHaveProperty('checked', false);
  });

  it('stays as the parent sets it when controlled', async () => {
    render(<Checkbox label="Mandatory" checked={false} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mandatory' }));
    expect(screen.getByRole('checkbox', { name: 'Mandatory' })).toHaveProperty('checked', false);
  });

  it('a disabled checkbox cannot be toggled', async () => {
    render(<Checkbox label="Mandatory" disabled />);
    await userEvent.click(screen.getByText('Mandatory'));
    expect(screen.getByRole('checkbox', { name: 'Mandatory' })).toHaveProperty('checked', false);
  });
});
