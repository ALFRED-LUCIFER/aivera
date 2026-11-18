import { render, screen } from '@testing-library/react';
import { createRef, type ChangeEvent, type FocusEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.tsx';
import { Checkbox } from './Checkbox.tsx';
import { Input, Select, Textarea } from './Field.tsx';

// The shape React Hook Form's register() returns (UseFormRegisterReturn), without adding the dependency here.
type Registered = {
  name: string;
  onChange: (event: ChangeEvent) => Promise<void>;
  onBlur: (event: FocusEvent) => Promise<void>;
  ref: (instance: HTMLElement | null) => void;
};

function register(name: string, seen: (HTMLElement | null)[]): Registered {
  return { name, onChange: async () => {}, onBlur: async () => {}, ref: (el) => seen.push(el) };
}

// This file is the typecheck test: without `ref` in the props types, `pnpm typecheck` fails on it.
// SAFETY: mutation check: InputProps = InputHTMLAttributes<HTMLInputElement> -> tsc failed (ref not assignable)
describe('controls accept a ref and a React Hook Form register() result', () => {
  it('forwards refs to the native element', () => {
    const input = createRef<HTMLInputElement>();
    const textarea = createRef<HTMLTextAreaElement>();
    const select = createRef<HTMLSelectElement>();
    const button = createRef<HTMLButtonElement>();
    const checkbox = createRef<HTMLInputElement>();
    render(
      <>
        <Input ref={input} aria-label="Title" />
        <Textarea ref={textarea} aria-label="Reason" />
        <Select ref={select} aria-label="Stage">
          <option>Round 1</option>
        </Select>
        <Button ref={button}>Save</Button>
        <Checkbox ref={checkbox} label="Mandatory" />
      </>,
    );
    expect(input.current).toBe(screen.getByRole('textbox', { name: 'Title' }));
    expect(textarea.current).toBe(screen.getByRole('textbox', { name: 'Reason' }));
    expect(select.current).toBe(screen.getByRole('combobox', { name: 'Stage' }));
    expect(button.current).toBe(screen.getByRole('button', { name: 'Save' }));
    expect(checkbox.current).toBe(screen.getByRole('checkbox', { name: 'Mandatory' }));
  });

  it('spreads register() onto Input, Textarea, Select and Checkbox', () => {
    const seen: (HTMLElement | null)[] = [];
    render(
      <>
        <Input {...register('title', seen)} aria-label="Title" />
        <Textarea {...register('reason', seen)} aria-label="Reason" />
        <Select {...register('stage', seen)} aria-label="Stage">
          <option>Round 1</option>
        </Select>
        <Checkbox {...register('mandatory', seen)} label="Mandatory" />
      </>,
    );
    expect(seen.map((el) => el?.getAttribute('name'))).toEqual(['title', 'reason', 'stage', 'mandatory']);
  });
});
